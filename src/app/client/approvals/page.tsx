import type { ReactNode } from "react";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import { assertPortal, hasPermission } from "@/lib/auth/permissions";
import { listClientApprovals } from "@/lib/approvals/client-view";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApprovalsList } from "./approvals-list";

// Every page under src/app/client/ must call requireActor() + assertPortal()
// as its first two lines, before any data fetch — see assertPortal's doc
// comment in src/lib/auth/permissions.ts for why the layout-level check
// alone is not enough.
export default async function ClientApprovalsPage() {
  const actor = await requireActor();
  assertPortal(actor, "client");

  const items = await listClientApprovals(db, actor, { pendingOnly: false });
  const canDecide = hasPermission(actor, "campaign:approveClient");

  const terms = items.filter((i) => i.kind === "channelTerms");
  const termsPending = terms.filter((i) => i.status !== "approved");
  const termsHistory = terms.filter((i) => i.status === "approved");
  const pendingCount = termsPending.length;

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

      <Card>
        <CardHeader>
          <CardTitle>Channel terms</CardTitle>
          <p className="text-sm text-muted-foreground">
            The volume, unit price and flight window for each channel. Approving fixes them for the
            flight.
          </p>
        </CardHeader>
        <CardContent>
          <ApprovalsList
            items={termsPending}
            canDecide={canDecide}
            emptyMessage="No channel terms to review."
          />
          {termsHistory.length > 0 && (
            <HistorySection count={termsHistory.length}>
              <ApprovalsList items={termsHistory} canDecide={false} emptyMessage="" />
            </HistorySection>
          )}
        </CardContent>
      </Card>

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
