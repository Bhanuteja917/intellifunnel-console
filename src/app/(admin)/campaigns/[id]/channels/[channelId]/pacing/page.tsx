import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import { assertPermission } from "@/lib/auth/permissions";
import { getCampaignForActor } from "@/lib/campaigns/crud";
import { getSetting } from "@/lib/settings/settings";
import { expectedToDate, paceSignal } from "@/lib/allocations/pacing";
import { NotFoundError } from "@/lib/errors";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

export default async function ChannelPacingPage({
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

  const timeZone = await getSetting(db, "operatingTimezone");
  const now = new Date();
  const channelExpected = expectedToDate(channel.contractedQuantity, channel.startDate, channel.endDate, now, timeZone);
  const channelPace = paceSignal(channel.deliveredCount, channelExpected);

  const allocations = await db.partnerAllocation.findMany({
    where: { campaignChannelId: channelId },
    include: { partnerOrganization: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });

  // Per-partner rejection rate: computed on read, not a stored counter —
  // a monitoring display value with no cap/enforcement dependency.
  const rejectionRows = await db.$queryRaw<{ partnerOrganizationId: string | null; rejected: bigint; total: bigint }[]>`
    SELECT ls."partnerOrganizationId",
           COUNT(*) FILTER (WHERE l."lifecycleStatus" = 'rejected') AS rejected,
           COUNT(*) AS total
    FROM "Lead" l
    JOIN "LeadSubmission" ls ON ls.id = l."submissionId"
    WHERE l."campaignChannelId" = ${channelId}
    GROUP BY ls."partnerOrganizationId"
  `;
  const rejectionByPartner = new Map(
    rejectionRows
      .filter((r) => r.partnerOrganizationId !== null)
      .map((r) => [r.partnerOrganizationId as string, { rejected: Number(r.rejected), total: Number(r.total) }]),
  );

  const badgeVariant = (pace: "behind" | "onPace" | "ahead") =>
    pace === "behind" ? "destructive" : pace === "ahead" ? "default" : "secondary";

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={`/campaigns/${campaign.id}` as Route}
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to campaign
      </Link>

      <Card>
        <CardHeader><CardTitle>Channel pacing</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-2">
          <div>Delivered: {channel.deliveredCount} / {channel.contractedQuantity} (reserved: {channel.reservedCount})</div>
          <div>Expected to date: {channelExpected.toFixed(1)}</div>
          <Badge variant={badgeVariant(channelPace)}>{channelPace}</Badge>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Per-partner rejection rate</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Partner</TableHead>
                <TableHead>Delivered / cap</TableHead>
                <TableHead>Pace</TableHead>
                <TableHead>Rejection rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allocations.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    No allocations on this channel.
                  </TableCell>
                </TableRow>
              )}
              {allocations.map((a) => {
                const expected = expectedToDate(a.allocatedQuantity, a.startDate, a.endDate, now, timeZone);
                const pace = paceSignal(a.deliveredCount, expected);
                const rejection = rejectionByPartner.get(a.partnerOrganizationId);
                const rate = rejection === undefined || rejection.total === 0
                  ? "—"
                  : `${((rejection.rejected / rejection.total) * 100).toFixed(0)}%`;
                return (
                  <TableRow key={a.id}>
                    <TableCell>{a.partnerOrganization.name}</TableCell>
                    <TableCell>{a.deliveredCount} / {a.allocatedQuantity}</TableCell>
                    <TableCell><Badge variant={badgeVariant(pace)}>{pace}</Badge></TableCell>
                    <TableCell>{rate}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
