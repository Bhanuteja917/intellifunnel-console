"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { retryDeliveryRunAction } from "./actions";

type Run = {
  id: string;
  method: "webhook" | "csv";
  status: "pending" | "success" | "failed" | "exhausted";
  attemptCount: number;
  lastError: string | null;
  createdAt: Date;
  completedAt: Date | null;
};

const STATUS_BADGE: Record<Run["status"], "secondary" | "default" | "destructive"> = {
  pending: "secondary",
  success: "default",
  failed: "destructive",
  exhausted: "destructive",
};

export function RunLogTable({ campaignId, campaignChannelId, runs }: { campaignId: string; campaignChannelId: string; runs: Run[] }) {
  const [pending, startTransition] = useTransition();

  function retry(runId: string) {
    startTransition(async () => {
      const result = await retryDeliveryRunAction(campaignId, campaignChannelId, runId);
      if (result.ok) toast.success("Run queued for retry");
      else toast.error(result.error);
    });
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Method</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Attempts</TableHead>
          <TableHead>Last error</TableHead>
          <TableHead>Created</TableHead>
          <TableHead>Completed</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.length === 0 && (
          <TableRow>
            <TableCell colSpan={7} className="text-center text-muted-foreground">No delivery runs yet.</TableCell>
          </TableRow>
        )}
        {runs.map((run) => (
          <TableRow key={run.id}>
            <TableCell>{run.method}</TableCell>
            <TableCell><Badge variant={STATUS_BADGE[run.status]}>{run.status}</Badge></TableCell>
            <TableCell>{run.attemptCount}</TableCell>
            <TableCell className="max-w-xs truncate">{run.lastError ?? "—"}</TableCell>
            <TableCell>{run.createdAt.toISOString().slice(0, 16).replace("T", " ")}</TableCell>
            <TableCell>{run.completedAt ? run.completedAt.toISOString().slice(0, 16).replace("T", " ") : "—"}</TableCell>
            <TableCell>
              {(run.status === "failed" || run.status === "exhausted") && (
                <Button size="sm" variant="outline" disabled={pending} onClick={() => retry(run.id)}>Retry</Button>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
