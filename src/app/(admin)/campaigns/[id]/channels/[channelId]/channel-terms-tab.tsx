import { db } from "@/lib/db";
import type { ApprovalStatus } from "@/lib/approvals/status";
import { fromMinorUnits } from "@/lib/money/currency";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const TERMS_BADGE: Record<ApprovalStatus, { variant: "default" | "secondary" | "destructive"; label: string }> = {
  approved: { variant: "default", label: "approved by client" },
  pending: { variant: "secondary", label: "awaiting client approval" },
  changesRequested: { variant: "destructive", label: "changes requested" },
  reapprovalNeeded: { variant: "destructive", label: "changed since approval" },
};

function row(label: string, value: string) {
  return (
    <div key={label} className="flex items-baseline justify-between gap-4 border-b py-2.5 last:border-b-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium tabular-nums">{value}</span>
    </div>
  );
}

export async function ChannelTermsTab({
  channel,
  channelLabel,
  termsStatus,
}: {
  channel: {
    id: string;
    contractedQuantity: number;
    clientUnitPriceMinor: bigint;
    costBudgetMinor: bigint | null;
    currency: string;
    startDate: Date;
    endDate: Date;
  };
  channelLabel: string | undefined;
  termsStatus: ApprovalStatus;
}) {
  const decisions = await db.channelTermsApproval.findMany({
    where: { campaignChannelId: channel.id },
    orderBy: { decidedAt: "desc" },
  });
  const deciders = await db.user.findMany({
    where: { id: { in: decisions.map((d) => d.decidedByUserId) } },
    select: { id: true, name: true, email: true },
  });
  const deciderById = new Map(deciders.map((u) => [u.id, u.name ?? u.email]));

  const badge = TERMS_BADGE[termsStatus];
  const total = fromMinorUnits(
    channel.clientUnitPriceMinor * BigInt(channel.contractedQuantity),
    channel.currency,
  );

  return (
    <div className="flex flex-col gap-6">
      {termsStatus === "changesRequested" && (() => {
        const latestComment = decisions.find(d => (d.decision as string) === "changesRequested")?.comments;
        return (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
            <p className="text-sm font-semibold text-destructive">Client requested changes</p>
            {latestComment && <p className="text-sm text-muted-foreground mt-1">{latestComment}</p>}
          </div>
        );
      })()}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Channel terms</CardTitle>
            <p className="text-sm text-muted-foreground">
              What the client is asked to approve. Decisions are made by the client in their own
              portal — there is no approve button here.
            </p>
          </div>
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </CardHeader>
        <CardContent className="flex flex-col">
          {row("Channel type", channelLabel ?? "—")}
          {row("Contracted quantity", `${channel.contractedQuantity} leads`)}
          {row(
            "Client unit price",
            `${channel.currency} ${fromMinorUnits(channel.clientUnitPriceMinor, channel.currency)}`,
          )}
          {row("Contracted value", `${channel.currency} ${total}`)}
          {row(
            "Cost budget",
            channel.costBudgetMinor === null
              ? "—"
              : `${channel.currency} ${fromMinorUnits(channel.costBudgetMinor, channel.currency)}`,
          )}
          {row(
            "Flight window",
            `${channel.startDate.toISOString().slice(0, 10)} – ${channel.endDate.toISOString().slice(0, 10)}`,
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Decision history</CardTitle>
          <p className="text-sm text-muted-foreground">
            Every decision the client has recorded on these terms, newest first.
          </p>
        </CardHeader>
        <CardContent>
          {decisions.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              No decision recorded yet — the client reviews these terms in their portal.
            </p>
          )}
          <div className="flex flex-col divide-y">
            {decisions.map((decision) => (
              <div key={decision.id} className="py-3 flex flex-col gap-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant={decision.decision === "approved" ? "default" : "destructive"}>
                    {decision.decision}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {deciderById.get(decision.decidedByUserId) ?? "—"}
                  </span>
                  <span className="text-sm text-muted-foreground ml-auto">
                    {decision.decidedAt.toISOString().slice(0, 16).replace("T", " ")}
                  </span>
                </div>
                {decision.comments && (
                  <p className="text-sm text-muted-foreground">{decision.comments}</p>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
