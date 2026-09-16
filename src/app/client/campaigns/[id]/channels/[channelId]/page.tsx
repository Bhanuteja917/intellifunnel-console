import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import { assertPortal } from "@/lib/auth/permissions";
import { getClientChannelDetail, type ClientChannelDetail } from "@/lib/approvals/client-channel-view";
import type { ApprovalStatus } from "@/lib/approvals/status";
import { NotFoundError } from "@/lib/errors";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { PacingScheduleCard } from "@/app/(admin)/campaigns/[id]/channels/[channelId]/pacing/pacing-schedule-card";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "terms", label: "Terms" },
  { id: "pacing", label: "Pacing" },
  { id: "delivery", label: "Delivery & runs" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const STATUS_LABEL: Record<ApprovalStatus, string> = {
  approved: "approved",
  pending: "needs your review",
  changesRequested: "changes requested",
  reapprovalNeeded: "changed — review again",
};

const STATUS_VARIANT: Record<ApprovalStatus, "default" | "secondary" | "destructive"> = {
  approved: "default",
  pending: "secondary",
  changesRequested: "destructive",
  reapprovalNeeded: "destructive",
};

const PACE_VARIANT: Record<"behind" | "onPace" | "ahead", "default" | "secondary" | "destructive"> = {
  behind: "destructive",
  onPace: "secondary",
  ahead: "default",
};

function statCard(label: string, value: string, hint: string) {
  return (
    <Card key={label}>
      <CardContent className="pt-6">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
        <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
      </CardContent>
    </Card>
  );
}

function paceCard(pace: "behind" | "onPace" | "ahead") {
  return (
    <Card key="Pace">
      <CardContent className="pt-6">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Pace</div>
        <div className="mt-2">
          <Badge variant={PACE_VARIANT[pace]}>{pace}</Badge>
        </div>
        <div className="mt-1 text-xs text-muted-foreground">vs. expected</div>
      </CardContent>
    </Card>
  );
}

function row(label: string, value: string) {
  return (
    <div key={label} className="flex items-baseline justify-between gap-4 border-b py-2.5 last:border-b-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

// Every page under src/app/client/ must call requireActor() + assertPortal()
// as its first two lines, before any data fetch — see assertPortal's doc
// comment in src/lib/auth/permissions.ts for why the layout-level check
// alone is not enough.
export default async function ClientChannelPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; channelId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id, channelId } = await params;
  const { tab: rawTab } = await searchParams;
  const actor = await requireActor();
  assertPortal(actor, "client");

  let channel: ClientChannelDetail;
  try {
    channel = await getClientChannelDetail(db, actor, id, channelId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const tab: TabId = TABS.some((t) => t.id === rawTab) ? (rawTab as TabId) : "overview";

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={`/client/campaigns/${channel.campaignId}` as Route}
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to campaign
      </Link>

      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-lg font-semibold">{channel.label}</h1>
                <Badge variant="outline" className="font-mono text-xs">{channel.campaignCode}</Badge>
                <Badge variant={STATUS_VARIANT[channel.termsStatus]}>
                  terms {STATUS_LABEL[channel.termsStatus]}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {channel.campaignName} · {channel.contractedQuantity} leads · {channel.currency} {channel.unitPrice} ·{" "}
                {channel.startDate.toISOString().slice(0, 10)} – {channel.endDate.toISOString().slice(0, 10)}
              </p>
            </div>
          </div>
          <div className="flex gap-1 overflow-x-auto border-t pt-1">
            {TABS.map((t) => (
              <Link
                key={t.id}
                href={`/client/campaigns/${channel.campaignId}/channels/${channel.channelId}?tab=${t.id}` as Route}
                className={cn(
                  "whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium",
                  tab === t.id
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>

      {tab === "overview" && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {statCard(
            "Delivered",
            `${channel.deliveredCount} / ${channel.contractedQuantity}`,
            `${channel.reservedCount} reserved`,
          )}
          {statCard("Expected to date", channel.expectedToDate.toFixed(1), "based on flight window")}
          {paceCard(channel.pace)}
        </div>
      )}

      {tab === "terms" && (
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Channel terms</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col">
              {row("Contracted quantity", `${channel.contractedQuantity} leads`)}
              {row("Unit price", `${channel.currency} ${channel.unitPrice}`)}
              {row(
                "Flight window",
                `${channel.startDate.toISOString().slice(0, 10)} – ${channel.endDate.toISOString().slice(0, 10)}`,
              )}
            </CardContent>
          </Card>

          {(channel.icp.length > 0 || channel.leadFields.length > 0) && (
            <div className="grid gap-6 lg:grid-cols-2">
              {channel.icp.length > 0 && (
                <Card>
                  <CardHeader className="pb-4"><CardTitle>Ideal customer profile</CardTitle></CardHeader>
                  <CardContent className="flex flex-col gap-4">
                    {channel.icp.map((r, i) => (
                      <div key={i} className="border-l-2 pl-3">
                        <span className="text-sm font-semibold">{r.label}</span>
                        <p className="mt-0.5 text-sm text-muted-foreground">{r.value}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {channel.leadFields.length > 0 && (
                <Card>
                  <CardHeader className="pb-4"><CardTitle>Lead requirements</CardTitle></CardHeader>
                  <CardContent className="flex flex-col gap-4">
                    {channel.leadFields.map((r, i) => (
                      <div key={i} className="border-l-2 pl-3">
                        <span className="text-sm font-semibold">{r.label}</span>
                        <p className="mt-0.5 text-sm text-muted-foreground">{r.detail}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Decision history</CardTitle>
              <p className="text-sm text-muted-foreground">Every decision recorded on these terms, newest first.</p>
            </CardHeader>
            <CardContent>
              {channel.decisions.length === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">No decision recorded yet.</p>
              )}
              <div className="flex flex-col divide-y">
                {channel.decisions.map((d, i) => (
                  <div key={i} className="flex flex-col gap-1 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={d.decision === "approved" ? "default" : "destructive"}>{d.decision}</Badge>
                      <span className="text-sm text-muted-foreground">{d.decidedByName}</span>
                      <span className="ml-auto text-sm text-muted-foreground">
                        {d.decidedAt.toISOString().slice(0, 16).replace("T", " ")}
                      </span>
                    </div>
                    {d.comments !== null && <p className="text-sm text-muted-foreground">{d.comments}</p>}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "pacing" && (
        <PacingScheduleCard
          channelId={channel.channelId}
          campaignId={channel.campaignId}
          contractedQuantity={channel.contractedQuantity}
          startDate={channel.startDate}
          endDate={channel.endDate}
          deliveredCount={channel.deliveredCount}
          expectedToDate={channel.expectedToDate}
          initialBuckets={channel.pacingBuckets}
          canWrite={false}
          timeZone={channel.timeZone}
        />
      )}

      {tab === "delivery" && (
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader><CardTitle>Delivery method</CardTitle></CardHeader>
            <CardContent className="flex flex-col">
              {channel.deliveryConfig === null ? (
                <p className="py-4 text-center text-sm text-muted-foreground">Not configured yet.</p>
              ) : (
                <>
                  {row("Method", channel.deliveryConfig.method)}
                  {row("Status", channel.deliveryConfig.status)}
                  {channel.deliveryConfig.method === "webhook" &&
                    row("Webhook URL", channel.deliveryConfig.webhookUrl ?? "—")}
                  {channel.deliveryConfig.method === "csv" &&
                    row("Schedule", channel.deliveryConfig.csvScheduleCron ?? "—")}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Delivery run log</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Method</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Attempts</TableHead>
                    <TableHead>Last error</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Completed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {channel.deliveryRuns.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground">
                        No delivery runs yet.
                      </TableCell>
                    </TableRow>
                  )}
                  {channel.deliveryRuns.map((run) => (
                    <TableRow key={run.id}>
                      <TableCell>{run.method}</TableCell>
                      <TableCell><Badge variant="secondary">{run.status}</Badge></TableCell>
                      <TableCell>{run.attemptCount}</TableCell>
                      <TableCell className="max-w-xs truncate">{run.lastError ?? "—"}</TableCell>
                      <TableCell>{run.createdAt.toISOString().slice(0, 16).replace("T", " ")}</TableCell>
                      <TableCell>
                        {run.completedAt ? run.completedAt.toISOString().slice(0, 16).replace("T", " ") : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
