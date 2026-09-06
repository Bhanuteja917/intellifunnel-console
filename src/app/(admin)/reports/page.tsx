import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import { assertPermission } from "@/lib/auth/permissions";
import { defaultDateRange } from "@/lib/reporting/shared";
import { getOpsDashboardReport } from "@/lib/reporting/ops";
import { getCampaignPerformanceReport } from "@/lib/reporting/campaigns";
import { getLeadBreakdownReport } from "@/lib/reporting/leads";
import { getChannelPerformanceReport } from "@/lib/reporting/channels";
import { getAssetPerformanceReport } from "@/lib/reporting/engagement";
import { DateRangePicker } from "@/components/reporting/date-range-picker";
import { EngagementUploadForm } from "./engagement-upload-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function parseDateParam(value: string | undefined, fallback: Date): Date {
  if (value === undefined) return fallback;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? fallback : new Date(ms);
}

export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; campaignId?: string }>;
}) {
  const actor = await requireActor();
  assertPermission(actor, "report:read");
  const { from, to, campaignId } = await searchParams;

  const fallback = defaultDateRange();
  const dateRange = { from: parseDateParam(from, fallback.from), to: parseDateParam(to, fallback.to) };

  const ops = await getOpsDashboardReport(db, actor, { dateRange });
  const campaigns = await db.campaign.findMany({
    select: { id: true, name: true, code: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const drilldown = campaignId !== undefined && campaignId !== ""
    ? {
        performance: await getCampaignPerformanceReport(db, actor, { campaignId, dateRange }),
        leads: await getLeadBreakdownReport(db, actor, { campaignId, dateRange }),
        channels: await getChannelPerformanceReport(db, actor, { campaignId, dateRange }),
        assets: await getAssetPerformanceReport(db, actor, { campaignId, dateRange }),
      }
    : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4">
        <DateRangePicker
          defaultFrom={dateRange.from.toISOString().slice(0, 10)}
          defaultTo={dateRange.to.toISOString().slice(0, 10)}
        />
        <EngagementUploadForm />
      </div>

      <Card>
        <CardHeader><CardTitle>Operations dashboard</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <div className="text-sm text-muted-foreground">SLA breaches</div>
              <div className="text-2xl font-semibold">{ops.slaBreaches}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Delivery failures</div>
              <div className="text-2xl font-semibold">{ops.deliveryFailures}</div>
            </div>
          </div>
          <Table>
            <TableHeader><TableRow><TableHead>Lifecycle status</TableHead><TableHead>Count</TableHead></TableRow></TableHeader>
            <TableBody>
              {Object.entries(ops.leadsByLifecycleStatus).map(([status, count]) => (
                <TableRow key={status}><TableCell>{status}</TableCell><TableCell>{count}</TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
          <Table>
            <TableHeader><TableRow><TableHead>Reject reason</TableHead><TableHead>Count</TableHead></TableRow></TableHeader>
            <TableBody>
              {ops.topRejectReasons.map((r) => (
                <TableRow key={r.rejectReasonId}><TableCell>{r.label}</TableCell><TableCell>{r.count}</TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Campaign drill-down</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form className="flex items-end gap-2">
            <input type="hidden" name="from" value={dateRange.from.toISOString().slice(0, 10)} />
            <input type="hidden" name="to" value={dateRange.to.toISOString().slice(0, 10)} />
            <select name="campaignId" defaultValue={campaignId ?? ""} className="h-9 rounded-md border px-2 text-sm">
              <option value="" disabled>Select a campaign...</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
              ))}
            </select>
            <button type="submit" className="h-9 rounded-md border px-3 text-sm">View</button>
          </form>

          {drilldown !== null && (
            <>
              <div className="grid grid-cols-3 gap-4">
                <div><div className="text-sm text-muted-foreground">Leads submitted</div><div className="text-xl font-semibold">{drilldown.performance.leadsSubmitted}</div></div>
                <div><div className="text-sm text-muted-foreground">Leads accepted</div><div className="text-xl font-semibold">{drilldown.performance.leadsAccepted}</div></div>
                <div><div className="text-sm text-muted-foreground">SLA breach rate</div><div className="text-xl font-semibold">{(drilldown.performance.slaBreachRate * 100).toFixed(1)}%</div></div>
              </div>

              <Table>
                <TableHeader><TableRow><TableHead>Channel</TableHead><TableHead>Contracted</TableHead><TableHead>Delivered</TableHead></TableRow></TableHeader>
                <TableBody>
                  {drilldown.channels.map((c) => (
                    <TableRow key={c.campaignChannelId}>
                      <TableCell>{c.channelTypeName}</TableCell>
                      <TableCell>{c.contractedQuantity}</TableCell>
                      <TableCell>{c.deliveredCount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <Table>
                <TableHeader>
                  <TableRow><TableHead>Asset placement</TableHead><TableHead>Impressions</TableHead><TableHead>Conversions</TableHead><TableHead>Rate</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {drilldown.assets.map((a) => (
                    <TableRow key={a.assetPlacementId}>
                      <TableCell>{a.assetName} ({a.formSlug})</TableCell>
                      <TableCell>{a.impressions}</TableCell>
                      <TableCell>{a.conversions}</TableCell>
                      <TableCell>{(a.conversionRate * 100).toFixed(1)}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
