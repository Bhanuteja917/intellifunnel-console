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

  // Anything still awaiting the client sorts above what is already settled.
  const order = (status: string) => (status === "approved" ? 1 : 0);
  const sorted = [...items].sort((a, b) => order(a.status) - order(b.status));
  const terms = sorted.filter((i) => i.kind === "channelTerms");
  const placements = sorted.filter((i) => i.kind === "placement");
  const pendingCount = items.filter((i) => i.status !== "approved").length;

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
            items={terms}
            canDecide={canDecide}
            emptyMessage="No channel terms to review."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Landing pages</CardTitle>
          <p className="text-sm text-muted-foreground">
            The live page each channel collects leads on. A page cannot go live until you approve it.
          </p>
        </CardHeader>
        <CardContent>
          <ApprovalsList
            items={placements}
            canDecide={canDecide}
            emptyMessage="No landing pages to review yet."
          />
        </CardContent>
      </Card>
    </div>
  );
}
