import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import { assertPermission, hasPermission } from "@/lib/auth/permissions";
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
import { ChannelTypeActions } from "./channel-type-actions";
import { EditChannelTypeDialog } from "./edit-channel-type-dialog";
import { NewChannelTypeDialog } from "./new-channel-type-dialog";

export default async function ChannelTypesPage() {
  const actor = await requireActor();
  assertPermission(actor, "channelType:read");

  const channelTypes = await db.channelType.findMany({
    include: { funnelStage: true },
    orderBy: [{ funnelStage: { sortOrder: "asc" } }, { name: "asc" }],
  });

  const canPublish = hasPermission(actor, "channelType:publish");
  const canWrite = hasPermission(actor, "channelType:write");
  const funnelStages = canWrite
    ? await db.funnelStage.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true } })
    : [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Channel types</CardTitle>
        {canWrite && <NewChannelTypeDialog funnelStages={funnelStages} />}
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Stage</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Pricing</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Active</TableHead>
              {(canPublish || canWrite) && <TableHead className="w-40" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {channelTypes.map((channelType) => (
              <TableRow key={channelType.id}>
                <TableCell>{channelType.funnelStage.name}</TableCell>
                <TableCell>{channelType.code}</TableCell>
                <TableCell>{channelType.pricingUnit}</TableCell>
                <TableCell>v{channelType.currentVersion}</TableCell>
                <TableCell>
                  <Badge variant={channelType.isActive ? "default" : "secondary"}>
                    {channelType.isActive ? "active" : "inactive"}
                  </Badge>
                </TableCell>
                {(canPublish || canWrite) && (
                  <TableCell>
                    <div className="flex gap-2">
                      {canWrite && (
                        <EditChannelTypeDialog
                          channelType={{
                            id: channelType.id,
                            code: channelType.code,
                            name: channelType.name,
                            funnelStageId: channelType.funnelStageId,
                            metricMode: channelType.metricMode,
                            pricingUnit: channelType.pricingUnit,
                            producesLeads: channelType.producesLeads,
                            requiresAsset: channelType.requiresAsset,
                            requiresTeleVerification: channelType.requiresTeleVerification,
                            verificationSlaBusinessDays: channelType.verificationSlaBusinessDays,
                            allowedMetricFields: channelType.allowedMetricFieldsJson as string[],
                          }}
                          funnelStages={funnelStages}
                        />
                      )}
                      <ChannelTypeActions
                        channelTypeId={channelType.id}
                        isActive={channelType.isActive}
                        canPublish={canPublish}
                        canDeactivate={canWrite}
                      />
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
