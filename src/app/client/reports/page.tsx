import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import { assertPortal, campaignOrgScopeClause } from "@/lib/auth/permissions";
import { defaultDateRange } from "@/lib/reporting/shared";
import { getCampaignPerformanceReport } from "@/lib/reporting/campaigns";
import { getLeadBreakdownReport } from "@/lib/reporting/leads";
import { getChannelPerformanceReport } from "@/lib/reporting/channels";
import { getAssetPerformanceReport } from "@/lib/reporting/engagement";
import { DateRangePicker } from "@/components/reporting/date-range-picker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function parseDateParam(value: string | undefined, fallback: Date): Date {
  if (value === undefined) return fallback;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? fallback : new Date(ms);
}

// Every page under src/app/client/ must call requireActor() + assertPortal()
// as its first two lines, before any data fetch — see assertPortal's doc
// comment in src/lib/auth/permissions.ts for why the layout-level check
// alone is not enough.
export default async function ClientReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; campaignId?: string }>;
}) {
  const actor = await requireActor();
  assertPortal(actor, "client");
  const { from, to, campaignId } = await searchParams;

  const fallback = defaultDateRange();
  const dateRange = { from: parseDateParam(from, fallback.from), to: parseDateParam(to, fallback.to) };

  const campaigns = await db.campaign.findMany({
    where: campaignOrgScopeClause(actor),
    select: { id: true, name: true, code: true },
    orderBy: { createdAt: "desc" },
  });
  const selectedCampaignId = (campaignId !== undefined && campaignId !== "")
    ? campaignId
    : campaigns[0]?.id;

  const report = selectedCampaignId !== undefined
    ? {
        performance: await getCampaignPerformanceReport(db, actor, { campaignId: selectedCampaignId, dateRange }),
        leads: await getLeadBreakdownReport(db, actor, { campaignId: selectedCampaignId, dateRange }),
        channels: await getChannelPerformanceReport(db, actor, { campaignId: selectedCampaignId, dateRange }),
        assets: await getAssetPerformanceReport(db, actor, { campaignId: selectedCampaignId, dateRange }),
      }
    : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4">
        <DateRangePicker
          defaultFrom={dateRange.from.toISOString().slice(0, 10)}
          defaultTo={dateRange.to.toISOString().slice(0, 10)}
        />
        <form className="flex items-end gap-2">
          <input type="hidden" name="from" value={dateRange.from.toISOString().slice(0, 10)} />
          <input type="hidden" name="to" value={dateRange.to.toISOString().slice(0, 10)} />
          <select name="campaignId" defaultValue={selectedCampaignId ?? ""} className="h-9 rounded-md border px-2 text-sm">
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
            ))}
          </select>
          <button type="submit" className="h-9 rounded-md border px-3 text-sm">View</button>
        </form>
      </div>

      {report === null && (
        <Card><CardContent className="p-6 text-center text-muted-foreground">No campaigns yet.</CardContent></Card>
      )}

      {report !== null && (
        <>
          <Card>
            <CardHeader><CardTitle>Campaign performance</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-3 gap-4">
              <div><div className="text-sm text-muted-foreground">Leads submitted</div><div className="text-xl font-semibold">{report.performance.leadsSubmitted}</div></div>
              <div><div className="text-sm text-muted-foreground">Leads accepted</div><div className="text-xl font-semibold">{report.performance.leadsAccepted}</div></div>
              <div><div className="text-sm text-muted-foreground">SLA breach rate</div><div className="text-xl font-semibold">{(report.performance.slaBreachRate * 100).toFixed(1)}%</div></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Channel performance</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>Channel</TableHead><TableHead>Contracted</TableHead><TableHead>Delivered</TableHead></TableRow></TableHeader>
                <TableBody>
                  {report.channels.map((c) => (
                    <TableRow key={c.campaignChannelId}>
                      <TableCell>{c.channelTypeName}</TableCell>
                      <TableCell>{c.contractedQuantity}</TableCell>
                      <TableCell>{c.deliveredCount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Lead breakdown</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>Verification status</TableHead><TableHead>Count</TableHead></TableRow></TableHeader>
                <TableBody>
                  {Object.entries(report.leads.byVerificationStatus).map(([status, count]) => (
                    <TableRow key={status}><TableCell>{status}</TableCell><TableCell>{count}</TableCell></TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Asset performance</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Placement</TableHead><TableHead>Impressions</TableHead><TableHead>Conversions</TableHead><TableHead>Rate</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {report.assets.map((a) => (
                    <TableRow key={a.assetPlacementId}>
                      <TableCell>{a.assetName} ({a.formSlug})</TableCell>
                      <TableCell>{a.impressions}</TableCell>
                      <TableCell>{a.conversions}</TableCell>
                      <TableCell>{(a.conversionRate * 100).toFixed(1)}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
