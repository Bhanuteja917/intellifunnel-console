"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ApprovalDecision } from "@prisma/client";
import type { ClientApprovalItem } from "@/lib/approvals/client-view";
import type { ApprovalStatus } from "@/lib/approvals/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { decideChannelTermsAction } from "./actions";

const STATUS_BADGE: Record<ApprovalStatus, { variant: "default" | "secondary" | "destructive"; label: string }> = {
  approved: { variant: "default", label: "approved" },
  pending: { variant: "secondary", label: "needs your review" },
  changesRequested: { variant: "destructive", label: "changes requested" },
  reapprovalNeeded: { variant: "destructive", label: "changed — review again" },
};

const DECIDABLE: ApprovalStatus[] = ["pending", "changesRequested", "reapprovalNeeded"];

type PendingDecision = { item: ClientApprovalItem; decision: ApprovalDecision };

export function ApprovalsList({
  items,
  canDecide,
  emptyMessage,
}: {
  items: ClientApprovalItem[];
  canDecide: boolean;
  emptyMessage: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState<PendingDecision | null>(null);
  const [comments, setComments] = useState("");

  function submit() {
    if (open === null) return;
    const { item, decision } = open;
    startTransition(async () => {
      const result = await decideChannelTermsAction({
        campaignChannelId: item.subjectId,
        campaignId: item.campaignId,
        decision,
        comments,
      });

      if (result.ok) {
        toast.success(decision === "approved" ? "Approved" : "Change request sent");
        setOpen(null);
        setComments("");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  // A rejection the agency cannot act on is useless, so the button stays
  // disabled until there is something to act on. The server rejects an empty
  // comment too.
  const rejectionNeedsComment = open?.decision === "rejected" && comments.trim() === "";

  return (
    <>
      <div className="flex flex-col">
        {items.map((item) => {
          const badge = STATUS_BADGE[item.status];
          const decidable = canDecide && DECIDABLE.includes(item.status);
          return (
            <div
              key={`${item.kind}-${item.subjectId}`}
              className="flex flex-wrap items-start justify-between gap-4 border-b py-4 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{item.campaignName}</span>
                  <Badge variant="outline" className="font-mono text-xs">{item.campaignCode}</Badge>
                  <span className="text-sm text-muted-foreground">· {item.channelLabel}</span>
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                </div>
                <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1">
                  {item.summary.map((row) => (
                    <div key={row.label} className="text-xs">
                      <dt className="inline text-muted-foreground">{row.label}: </dt>
                      <dd className="inline font-medium break-all">{row.value}</dd>
                    </div>
                  ))}
                </dl>
                {item.lastComments !== null && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Your note: {item.lastComments}
                  </p>
                )}
              </div>
              {decidable && (
                <div className="flex flex-none gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setComments("");
                      setOpen({ item, decision: "rejected" });
                    }}
                  >
                    Request a change
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      setComments("");
                      setOpen({ item, decision: "approved" });
                    }}
                  >
                    Approve
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Dialog open={open !== null} onOpenChange={(next) => !next && setOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {open?.decision === "approved" ? "Approve" : "Request a change"}
              {" — channel terms"}
            </DialogTitle>
          </DialogHeader>
          <div className="rounded-md border">
            {(open?.item.summary ?? []).map((row) => (
              <div
                key={row.label}
                className="flex justify-between gap-4 border-b px-3 py-2 text-sm last:border-b-0"
              >
                <span className="text-muted-foreground">{row.label}</span>
                <span className="font-medium break-all text-right">{row.value}</span>
              </div>
            ))}
          </div>
          <div>
            <label htmlFor="approval-comments" className="text-sm font-medium">
              {open?.decision === "approved" ? "Note to the agency (optional)" : "What needs to change?"}
            </label>
            <textarea
              id="approval-comments"
              value={comments}
              onChange={(event) => setComments(event.target.value)}
              rows={3}
              className="mt-1.5 w-full rounded-md border bg-transparent px-3 py-2 text-sm"
              placeholder={
                open?.decision === "approved"
                  ? "Anything we should know before launch…"
                  : "Tell us what to change before you can approve this"
              }
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(null)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending || rejectionNeedsComment}>
              {open?.decision === "approved" ? "Approve" : "Send change request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
