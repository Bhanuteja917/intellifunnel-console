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

export default async function ChannelTypesPage() {
  const actor = await requireActor();
  assertPermission(actor, "channelType:read");

  const channelTypes = await db.channelType.findMany({
    include: { funnelStage: true },
    orderBy: [{ funnelStage: { sortOrder: "asc" } }, { name: "asc" }],
  });

  const canPublish = hasPermission(actor, "channelType:publish");
  const canWrite = hasPermission(actor, "channelType:write");

  return (
    <Card>
      <CardHeader><CardTitle>Channel types</CardTitle></CardHeader>
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
                    <ChannelTypeActions
                      channelTypeId={channelType.id}
                      isActive={channelType.isActive}
                      canPublish={canPublish}
                      canDeactivate={canWrite}
                    />
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
