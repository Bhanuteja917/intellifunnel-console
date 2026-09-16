import type { ReactNode } from "react";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import { assertPortal, hasPermission } from "@/lib/auth/permissions";
import { listClientApprovals, type ClientApprovalItem } from "@/lib/approvals/client-view";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApprovalsList } from "./approvals-list";

type ChannelGroup = {
  channelId: string;
  channelLabel: string;
  campaignName: string;
  campaignCode: string;
  items: ClientApprovalItem[];
};

// Items already arrive grouped by channel (listClientApprovals pushes a
// channel's terms item immediately before its placement items), so a plain
// insertion-order Map keyed by channelId is enough — no re-sorting needed.
function groupByChannel(items: ClientApprovalItem[]): ChannelGroup[] {
  const groups = new Map<string, ChannelGroup>();
  for (const item of items) {
    let group = groups.get(item.channelId);
    if (group === undefined) {
      group = {
        channelId: item.channelId,
        channelLabel: item.channelLabel,
        campaignName: item.campaignName,
        campaignCode: item.campaignCode,
        items: [],
      };
      groups.set(item.channelId, group);
    }
    group.items.push(item);
  }
  return Array.from(groups.values());
}

// Every page under src/app/client/ must call requireActor() + assertPortal()
// as its first two lines, before any data fetch — see assertPortal's doc
// comment in src/lib/auth/permissions.ts for why the layout-level check
// alone is not enough.
export default async function ClientApprovalsPage() {
  const actor = await requireActor();
  assertPortal(actor, "client");

  const items = await listClientApprovals(db, actor, { pendingOnly: false });
  const canDecide = hasPermission(actor, "campaign:approveClient");

  const pendingCount = items.filter((i) => i.status !== "approved").length;
  const channelGroups = groupByChannel(items);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Approvals</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {pendingCount === 0
            ? "Nothing needs your approval right now."
            : `${pendingCount} item${pendingCount === 1 ? "" : "s"} need${pendingCount === 1 ? "s" : ""} your review before the work can go live.`}
        </p>
      </div>

      {!canDecide && (
        <p className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
          You can see everything awaiting approval, but only a client admin in your organisation can
          approve or request changes.
        </p>
      )}

      {channelGroups.length === 0 && (
        <p className="text-sm text-muted-foreground">Nothing to review yet.</p>
      )}

      {channelGroups.map((group) => {
        const pending = group.items.filter((i) => i.status !== "approved");
        const history = group.items.filter((i) => i.status === "approved");
        return (
          <Card key={group.channelId}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                {group.channelLabel}
                <Badge variant="outline" className="font-mono text-xs">{group.campaignCode}</Badge>
              </CardTitle>
              <p className="text-sm text-muted-foreground">{group.campaignName}</p>
            </CardHeader>
            <CardContent>
              <ApprovalsList
                items={pending}
                canDecide={canDecide}
                emptyMessage="Nothing outstanding on this channel."
              />
              {history.length > 0 && (
                <HistorySection count={history.length}>
                  <ApprovalsList items={history} canDecide={false} emptyMessage="" />
                </HistorySection>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function HistorySection({ count, children }: { count: number; children: ReactNode }) {
  return (
    <details className="mt-4 pt-4 border-t">
      <summary className="text-sm text-muted-foreground cursor-pointer hover:text-foreground">
        {count} approved
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}
