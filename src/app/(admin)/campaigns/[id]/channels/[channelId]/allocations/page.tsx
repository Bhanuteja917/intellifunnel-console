import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import { assertPermission, hasPermission } from "@/lib/auth/permissions";
import { getCampaignForActor } from "@/lib/campaigns/crud";
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

export default async function AllocationsPage({
  params,
}: {
  params: Promise<{ id: string; channelId: string }>;
}) {
  const { id, channelId } = await params;
  const actor = await requireActor();
  assertPermission(actor, "allocation:read");

  let campaign;
  try {
    campaign = await getCampaignForActor(db, actor, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const channel = campaign.channels.find((c) => c.id === channelId);
  if (channel === undefined) notFound();

  const allocations = await db.partnerAllocation.findMany({
    where: { campaignChannelId: channelId },
    include: { partnerOrganization: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });

  const canWrite = hasPermission(actor, "allocation:write");
  const channelLabel = (channel.channelTypeVersion.definitionJson as { name?: string; code?: string }).name
    ?? (channel.channelTypeVersion.definitionJson as { code?: string }).code;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <Link
          href={`/campaigns/${campaign.id}` as Route}
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to campaign
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">{campaign.name}</h1>
          <Badge variant="outline">{campaign.code}</Badge>
          <span className="text-muted-foreground">Allocations — {channelLabel}</span>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Partner allocations</CardTitle>
          {canWrite && (
            <Button asChild size="sm">
              <Link href={`/campaigns/${campaign.id}/channels/${channel.id}/allocations/new` as Route}>
                New allocation
              </Link>
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Partner</TableHead>
                <TableHead>Quantity</TableHead>
                <TableHead>Payout rate</TableHead>
                <TableHead>Window</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Reveal client identity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allocations.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No allocations yet.
                  </TableCell>
                </TableRow>
              )}
              {allocations.map((allocation) => (
                <TableRow key={allocation.id}>
                  <TableCell>
                    <Link
                      href={`/campaigns/${campaign.id}/channels/${channel.id}/allocations/${allocation.id}` as Route}
                      className="underline"
                    >
                      {allocation.partnerOrganization.name}
                    </Link>
                  </TableCell>
                  <TableCell>{allocation.allocatedQuantity}</TableCell>
                  <TableCell>
                    {allocation.payoutCurrency}{" "}
                    {fromMinorUnits(allocation.payoutRateMinor, allocation.payoutCurrency)}
                  </TableCell>
                  <TableCell>
                    {allocation.startDate.toISOString().slice(0, 10)} –{" "}
                    {allocation.endDate.toISOString().slice(0, 10)}
                  </TableCell>
                  <TableCell>
                    <Badge>{allocation.status}</Badge>
                  </TableCell>
                  <TableCell>{allocation.revealClientIdentity ? "Yes" : "No"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
