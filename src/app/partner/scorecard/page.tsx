import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import { assertPortal } from "@/lib/auth/permissions";
import { defaultDateRange } from "@/lib/reporting/shared";
import { getPartnerScorecardReport } from "@/lib/reporting/partners";
import { DateRangePicker } from "@/components/reporting/date-range-picker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function parseDateParam(value: string | undefined, fallback: Date): Date {
  if (value === undefined) return fallback;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? fallback : new Date(ms);
}

// Every page under src/app/partner/ must call requireActor() + assertPortal()
// as its first two lines, before any data fetch — see assertPortal's doc
// comment in src/lib/auth/permissions.ts for why the layout-level check
// alone is not enough.
export default async function PartnerScorecardPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const actor = await requireActor();
  assertPortal(actor, "partner");
  const { from, to } = await searchParams;

  const fallback = defaultDateRange();
  const dateRange = { from: parseDateParam(from, fallback.from), to: parseDateParam(to, fallback.to) };

  const report = await getPartnerScorecardReport(db, actor, {
    partnerOrganizationId: actor.organizationId, dateRange,
  });

  return (
    <div className="flex flex-col gap-6">
      <DateRangePicker
        defaultFrom={dateRange.from.toISOString().slice(0, 10)}
        defaultTo={dateRange.to.toISOString().slice(0, 10)}
      />

      <Card>
        <CardHeader><CardTitle>Your scorecard</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div><div className="text-sm text-muted-foreground">Acceptance rate</div><div className="text-2xl font-semibold">{(report.acceptanceRate * 100).toFixed(1)}%</div></div>
          <div><div className="text-sm text-muted-foreground">Leads submitted / day</div><div className="text-2xl font-semibold">{report.leadsSubmittedPerDay.toFixed(1)}</div></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Reject reasons</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Reason</TableHead><TableHead>Count</TableHead></TableRow></TableHeader>
            <TableBody>
              {report.rejectReasonBreakdown.length === 0 && (
                <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground">No rejections in this window.</TableCell></TableRow>
              )}
              {report.rejectReasonBreakdown.map((r) => (
                <TableRow key={r.rejectReasonId}><TableCell>{r.label}</TableCell><TableCell>{r.count}</TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>By channel</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Channel</TableHead><TableHead>Delivered / cap</TableHead>
                <TableHead>Leads submitted</TableHead><TableHead>Accepted</TableHead><TableHead>Rejected</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.channelBreakdown.map((c) => (
                <TableRow key={c.campaignChannelId}>
                  <TableCell>{c.channelTypeName}</TableCell>
                  <TableCell>{c.deliveredCount} / {c.allocatedQuantity}</TableCell>
                  <TableCell>{c.leadsSubmitted}</TableCell>
                  <TableCell>{c.leadsAccepted}</TableCell>
                  <TableCell>{c.leadsRejected}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
