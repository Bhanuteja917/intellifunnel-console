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
  //
  // The numerator counts `rejectReasonId IS NOT NULL`, not
  // `lifecycleStatus = 'rejected'`: only `decideLeadVerification` ever moves
  // a lead to `lifecycleStatus: 'rejected'`. Every row rejected *at intake*
  // (suppression, ICP/TAL mismatch, duplicate, and this epic's own
  // CHANNEL_CAP_REACHED / ALLOCATION_CAP_EXCEEDED) stays at
  // `lifecycleStatus: 'new'` with `verificationStatus: 'failed'`, so it
  // counted in the denominator but never the numerator — a partner whose
  // file was 90% suppressed junk read as a 0% rejection rate.
  // `Lead.rejectReasonId` is set on both paths (and cleared again on accept),
  // so it is the one column that captures every rejection regardless of
  // which side rejected it. It is paired with `verificationStatus = 'failed'`
  // because `rejectReasonId` alone would also match a *pending* row: an
  // advisory ICP/TAL mismatch leaves the lead at `needsReview` while still
  // recording the advisory reason code, and a lead nobody has decided yet
  // must not count as rejected. `verificationStatus = 'failed'` is set by
  // exactly the two rejecting paths and nothing else.
  const rejectionRows = await db.$queryRaw<{ partnerOrganizationId: string | null; rejected: bigint; total: bigint }[]>`
    SELECT ls."partnerOrganizationId",
           COUNT(*) FILTER (WHERE l."rejectReasonId" IS NOT NULL AND l."verificationStatus" = 'failed') AS rejected,
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
                {/* Matches the channel-level card above, which already shows
                    reserved — capacity is enforced on reserved + delivered. */}
                <TableHead>Reserved</TableHead>
                <TableHead>Remaining</TableHead>
                <TableHead>Pace</TableHead>
                <TableHead>Rejection rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allocations.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
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
                    <TableCell>{a.reservedCount}</TableCell>
                    <TableCell>{Math.max(a.allocatedQuantity - a.deliveredCount - a.reservedCount, 0)}</TableCell>
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
