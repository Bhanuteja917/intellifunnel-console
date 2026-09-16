import { db } from "@/lib/db";
import type { ApprovalStatus } from "@/lib/approvals/status";
import { fromMinorUnits } from "@/lib/money/currency";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChannelTermsCard, TERMS_BADGE } from "./channel-terms-card";

export { TERMS_BADGE };

export async function ChannelTermsTab({
  campaignId,
  channel,
  channelLabel,
  termsStatus,
  canEdit,
  blockedReason,
}: {
  campaignId: string;
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
  canEdit: boolean;
  /** Empty when the channel's terms are editable; otherwise the reason they are not. */
  blockedReason: string | null;
}) {
  const decisions = await db.channelApproval.findMany({
    where: { campaignChannelId: channel.id },
    orderBy: { decidedAt: "desc" },
  });

  return (
    <div className="flex flex-col gap-6">
      {termsStatus === "changesRequested" && (() => {
        const latestComment = decisions.find(d => d.decision === "rejected")?.comments;
        return (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
            <p className="text-sm font-semibold text-destructive">Client requested changes</p>
            {latestComment && <p className="text-sm text-muted-foreground mt-1">{latestComment}</p>}
          </div>
        );
      })()}
      <ChannelTermsCard
        campaignId={campaignId}
        campaignChannelId={channel.id}
        channelLabel={channelLabel}
        termsStatus={termsStatus}
        currency={channel.currency}
        canEdit={canEdit}
        blockedReason={blockedReason}
        initial={{
          contractedQuantity: channel.contractedQuantity,
          clientUnitPriceMinor: channel.clientUnitPriceMinor,
          costBudget:
            channel.costBudgetMinor === null ? "" : fromMinorUnits(channel.costBudgetMinor, channel.currency),
          startDate: channel.startDate.toISOString().slice(0, 10),
          endDate: channel.endDate.toISOString().slice(0, 10),
        }}
      />
    </div>
  );
}

export async function DecisionHistoryTab({ channelId }: { channelId: string }) {
  const decisions = await db.channelApproval.findMany({
    where: { campaignChannelId: channelId },
    orderBy: { decidedAt: "desc" },
  });
  const deciders = await db.user.findMany({
    where: { id: { in: decisions.map((d) => d.decidedByUserId) } },
    select: { id: true, name: true, email: true },
  });
  const deciderById = new Map(deciders.map((u) => [u.id, u.name ?? u.email]));

  return (
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
  );
}
