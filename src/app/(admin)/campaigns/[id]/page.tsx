import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import { getCampaignForActor } from "@/lib/campaigns/crud";
import { hasPermission } from "@/lib/auth/permissions";
import { fromMinorUnits } from "@/lib/money/currency";
import { NotFoundError } from "@/lib/errors";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AddChannelDialog } from "./add-channel-dialog";
import { ApprovalActions } from "./approval-actions";
import { IcpCriteriaEditor } from "./icp-criteria-editor";
import { LeadFieldSpecEditor } from "./lead-field-spec-editor";

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor();

  let campaign;
  try {
    campaign = await getCampaignForActor(db, actor, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const canAddChannel = hasPermission(actor, "campaign:write") && campaign.status === "draft";
  const channelTypes = canAddChannel
    ? await db.channelType.findMany({
        where: { isActive: true, currentVersion: { gt: 0 } },
        select: { id: true, name: true, code: true },
        orderBy: { name: "asc" },
      })
    : [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">{campaign.name}</h1>
        <Badge variant="outline">{campaign.code}</Badge>
        <Badge>{campaign.status}</Badge>
      </div>

      <ApprovalActions
        campaignId={campaign.id}
        status={campaign.status}
        canSubmit={hasPermission(actor, "campaign:submitInternal")}
        canApproveInternal={hasPermission(actor, "campaign:approveInternal")}
        canApproveClient={hasPermission(actor, "campaign:approveClient")}
      />

      <Card>
        <CardHeader><CardTitle>ICP criteria</CardTitle></CardHeader>
        <CardContent>
          <IcpCriteriaEditor
            campaignId={campaign.id}
            initialCriteria={campaign.icpCriteria.map((c) => ({
              dimension: c.dimension,
              operator: c.operator,
              values: c.valuesJson as unknown[],
              isMandatory: c.isMandatory,
            }))}
            canEdit={hasPermission(actor, "campaign:write") && campaign.status === "draft"}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Lead field spec</CardTitle></CardHeader>
        <CardContent>
          <LeadFieldSpecEditor
            campaignId={campaign.id}
            initialFields={campaign.leadFieldSpecs.map((f) => ({
              fieldKey: f.fieldKey,
              label: f.label,
              dataType: f.dataType,
              isRequired: f.isRequired,
              rejectIfMissing: f.rejectIfMissing,
              allowedValues: (f.allowedValuesJson as unknown[] | null) ?? undefined,
              validationPattern: f.validationPattern ?? undefined,
            }))}
            canEdit={hasPermission(actor, "campaign:write") && campaign.status === "draft"}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Channels</CardTitle>
          {canAddChannel && (
            <AddChannelDialog
              campaignId={campaign.id}
              campaignCurrency={campaign.currency}
              campaignStartDate={campaign.startDate.toISOString().slice(0, 10)}
              campaignEndDate={campaign.endDate.toISOString().slice(0, 10)}
              channelTypes={channelTypes}
            />
          )}
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Channel type</TableHead>
                <TableHead>Quantity</TableHead>
                <TableHead>Unit price</TableHead>
                <TableHead>Window</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaign.channels.map((channel) => (
                <TableRow key={channel.id}>
                  <TableCell>
                    {(channel.channelTypeVersion.definitionJson as { code?: string }).code} v
                    {channel.channelTypeVersion.version}
                  </TableCell>
                  <TableCell>{channel.contractedQuantity}</TableCell>
                  <TableCell>
                    {channel.currency}{" "}
                    {fromMinorUnits(channel.clientUnitPriceMinor, channel.currency)}
                  </TableCell>
                  <TableCell>
                    {channel.startDate.toISOString().slice(0, 10)} –{" "}
                    {channel.endDate.toISOString().slice(0, 10)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
