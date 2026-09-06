import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import { getCampaignForActor } from "@/lib/campaigns/crud";
import { hasPermission } from "@/lib/auth/permissions";
import { fromMinorUnits } from "@/lib/money/currency";
import { NotFoundError } from "@/lib/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

  const canEditConfig = hasPermission(actor, "campaign:write") && campaign.status === "draft";
  const channelTypes = canEditConfig
    ? await db.channelType.findMany({
        where: { isActive: true, currentVersion: { gt: 0 } },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      })
    : [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">{campaign.name}</h1>
        <Badge variant="outline">{campaign.code}</Badge>
        <Badge>{campaign.status}</Badge>
        {actor.isInternal && (
          <Button asChild variant="outline" size="sm">
            <Link href={`/campaigns/${campaign.id}/leads`}>View leads</Link>
          </Button>
        )}
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
              values: Array.isArray(c.valuesJson) ? c.valuesJson : [],
              isMandatory: c.isMandatory,
            }))}
            canEdit={canEditConfig}
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
              allowedValues: Array.isArray(f.allowedValuesJson) ? f.allowedValuesJson : undefined,
              validationPattern: f.validationPattern ?? undefined,
            }))}
            canEdit={canEditConfig}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Channels</CardTitle>
          {canEditConfig && (
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
                <TableHead>Placements</TableHead>
                <TableHead>Allocations</TableHead>
                <TableHead>Pacing</TableHead>
                <TableHead>Delivery</TableHead>
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
                  <TableCell>
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/campaigns/${campaign.id}/channels/${channel.id}/placements` as Route}>
                        Placements
                      </Link>
                    </Button>
                  </TableCell>
                  <TableCell>
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/campaigns/${campaign.id}/channels/${channel.id}/allocations` as Route}>
                        Allocations
                      </Link>
                    </Button>
                  </TableCell>
                  <TableCell>
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/campaigns/${campaign.id}/channels/${channel.id}/pacing` as Route}>
                        Pacing
                      </Link>
                    </Button>
                  </TableCell>
                  <TableCell>
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/campaigns/${campaign.id}/channels/${channel.id}/delivery` as Route}>
                        Delivery
                      </Link>
                    </Button>
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
