"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { type PaceSignal, expectedToDateWithSchedule, paceSignal } from "@/lib/allocations/pacing";
import { generateBuckets } from "@/lib/channels/pacing-schedule";
import {
  saveChannelPacingScheduleAction,
  deleteChannelPacingScheduleAction,
} from "./actions";

type Bucket = {
  periodStart: Date;
  periodEnd: Date;
  targetQuantity: number;
};

type PacingScheduleCardProps = {
  channelId: string;
  campaignId: string;
  contractedQuantity: number;
  startDate: Date;
  endDate: Date;
  deliveredCount: number;
  expectedToDate: number;
  initialBuckets: Bucket[];
  canWrite: boolean;
  timeZone: string;
};

function formatBucketPeriod(bucket: { periodStart: Date; periodEnd: Date }): string {
  const start = bucket.periodStart;
  const end = bucket.periodEnd;
  const startMonth = start.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const endMonth = end.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const startYear = start.getUTCFullYear();
  const endYear = end.getUTCFullYear();

  // Full calendar month: periodStart is 1st and periodEnd is last day of same month
  if (
    start.getUTCDate() === 1 &&
    end.getUTCDate() === new Date(endYear, end.getUTCMonth() + 1, 0).getUTCDate() &&
    start.getUTCMonth() === end.getUTCMonth() &&
    startYear === endYear
  ) {
    return `${startMonth} ${startYear}`;
  }
  // Partial period
  return `${startMonth} ${start.getUTCDate()} – ${endMonth} ${end.getUTCDate()}, ${endYear}`;
}

const badgeVariant = (pace: PaceSignal) =>
  pace === "behind" ? "destructive" : pace === "ahead" ? "default" : "secondary";

export function PacingScheduleCard({
  channelId,
  campaignId,
  contractedQuantity,
  startDate,
  endDate,
  deliveredCount,
  expectedToDate,
  initialBuckets,
  canWrite,
  timeZone,
}: PacingScheduleCardProps) {
  const router = useRouter();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingExisting, setEditingExisting] = useState(false);
  const [granularity, setGranularity] = useState<"month" | "week">("month");
  const [rows, setRows] = useState<Bucket[]>([]);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  // State A: no custom schedule, editor closed
  if (initialBuckets.length === 0 && !editorOpen) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Channel pacing</CardTitle>
          {canWrite && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const generated = generateBuckets(
                  { startDate, endDate, contractedQuantity },
                  "month",
                );
                setRows(generated);
                setGranularity("month");
                setEditingExisting(false);
                setEditorOpen(true);
              }}
            >
              Set custom pacing
            </Button>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <div>
            Delivered: {deliveredCount} / {contractedQuantity}
          </div>
          <div>Expected to date: {expectedToDate.toFixed(1)}</div>
          <Badge variant={badgeVariant(paceSignal(deliveredCount, expectedToDate))}>
            {paceSignal(deliveredCount, expectedToDate)}
          </Badge>
        </CardContent>
      </Card>
    );
  }

  // State B: custom schedule present, editor closed
  if (initialBuckets.length > 0 && !editorOpen) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle>Channel pacing</CardTitle>
            <Badge variant="outline">Custom schedule</Badge>
          </div>
          {canWrite && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setRows([...initialBuckets]);
                  setGranularity("month");
                  setEditingExisting(true);
                  setEditorOpen(true);
                }}
              >
                Edit schedule
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmRemove(true)}
              >
                Remove schedule
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {/* Overall numbers */}
          <div>
            Delivered: {deliveredCount} / {contractedQuantity}
          </div>
          <div>Expected to date: {expectedToDate.toFixed(1)}</div>
          <Badge variant={badgeVariant(paceSignal(deliveredCount, expectedToDate))}>
            {paceSignal(deliveredCount, expectedToDate)}
          </Badge>

          {/* Per-bucket table */}
          <Table className="mt-4">
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Pace</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {initialBuckets.map((bucket, i) => {
                const bucketExpected = expectedToDateWithSchedule(
                  [bucket],
                  new Date(),
                  timeZone,
                );
                const bucketPace = paceSignal(0, bucketExpected);
                return (
                  <TableRow key={i}>
                    <TableCell>{formatBucketPeriod(bucket)}</TableCell>
                    <TableCell>{bucket.targetQuantity}</TableCell>
                    <TableCell>
                      <Badge variant={badgeVariant(bucketPace)}>{bucketPace}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {/* Confirm remove dialog */}
          {confirmRemove && (
            <div className="mt-4 flex items-center gap-4 rounded border border-destructive p-4">
              <span className="text-sm">
                Remove the custom schedule? This reverts to linear pacing.
              </span>
              <Button
                variant="destructive"
                size="sm"
                disabled={removing}
                onClick={async () => {
                  setRemoving(true);
                  const result = await deleteChannelPacingScheduleAction({
                    campaignId,
                    channelId,
                  });
                  if (result.ok) {
                    router.refresh();
                  } else {
                    toast.error(result.error ?? "Failed to remove schedule");
                    setRemoving(false);
                    setConfirmRemove(false);
                  }
                }}
              >
                {removing ? "Removing..." : "Confirm remove"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmRemove(false)}
              >
                Cancel
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // Editor open (editorOpen === true)
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {editingExisting ? "Edit pacing schedule" : "Set custom pacing"}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* Granularity toggle */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Granularity</span>
          {(["month", "week"] as const).map((g) => (
            <Button
              key={g}
              variant={granularity === g ? "default" : "outline"}
              size="sm"
              onClick={() => {
                if (granularity !== g) {
                  const newRows = generateBuckets(
                    { startDate, endDate, contractedQuantity },
                    g,
                  );
                  setRows(newRows);
                  setGranularity(g);
                }
              }}
            >
              {g.charAt(0).toUpperCase() + g.slice(1)}
            </Button>
          ))}
        </div>

        {/* Row table */}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Period</TableHead>
              <TableHead>Target leads</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, i) => (
              <TableRow key={i}>
                <TableCell>{formatBucketPeriod(row)}</TableCell>
                <TableCell>
                  <Input
                    type="number"
                    min={0}
                    value={row.targetQuantity}
                    className="w-24"
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      setRows((prev) =>
                        prev.map((r, j) =>
                          j === i ? { ...r, targetQuantity: isNaN(val) ? 0 : val } : r,
                        ),
                      );
                    }}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {/* Totals */}
        <div className="flex items-center gap-2 text-sm">
          <span>
            Total: {rows.reduce((s, r) => s + r.targetQuantity, 0)} / {contractedQuantity}{" "}
            contracted
          </span>
          {rows.reduce((s, r) => s + r.targetQuantity, 0) === contractedQuantity ? (
            <span className="text-green-600">&#10003;</span>
          ) : (
            <span className="text-destructive">&#10007;</span>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setEditorOpen(false);
              setConfirmRemove(false);
            }}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={
              rows.reduce((s, r) => s + r.targetQuantity, 0) !== contractedQuantity ||
              saving
            }
            onClick={async () => {
              setSaving(true);
              const result = await saveChannelPacingScheduleAction({
                campaignId,
                channelId,
                buckets: rows.map((r) => ({
                  periodStart: r.periodStart.toISOString(),
                  periodEnd: r.periodEnd.toISOString(),
                  targetQuantity: r.targetQuantity,
                })),
              });
              if (result.ok) {
                setEditorOpen(false);
                router.refresh();
              } else {
                toast.error(result.error ?? "Failed to save schedule");
                setSaving(false);
              }
            }}
          >
            {saving ? "Saving..." : "Save schedule"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
