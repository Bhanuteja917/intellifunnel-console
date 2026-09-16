"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { ChannelSetupStepKey } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import type { ChannelStep } from "@/lib/channels/readiness";
import { addChannelSetupStepAction, removeChannelSetupStepAction } from "./actions";

type Props = {
  campaignId: string;
  channelId: string;
  steps: ChannelStep[];
  requiredDoneCount: number;
  requiredTotalCount: number;
  addableSteps: { key: ChannelSetupStepKey; title: string }[];
  editable: boolean;
};

export function SetupChecklistCard({
  campaignId,
  channelId,
  steps,
  requiredDoneCount,
  requiredTotalCount,
  addableSteps,
  editable,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);

  const required = steps.filter((s) => s.requirement === "required");
  const optional = steps.filter((s) => s.requirement === "optional");

  const editRows = [
    ...steps.map((s) => ({ key: s.key, title: s.title, hint: s.hint, locked: s.locked, present: true })),
    ...addableSteps.map((s) => ({ key: s.key, title: s.title, hint: undefined, locked: false, present: false })),
  ];

  function run(action: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        toast.success(success);
        router.refresh();
      } else {
        toast.error(result.error ?? "Something went wrong");
      }
    });
  }

  const stepRow = (step: ChannelStep) => (
    <div key={step.key} className="flex items-center gap-3 border-b py-3 last:border-b-0">
      <div
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full border text-xs",
          step.done
            ? "border-foreground bg-foreground text-background"
            : "border-muted-foreground/40 text-muted-foreground",
        )}
      >
        {step.done ? "✓" : ""}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{step.title}</span>
          {step.requirement === "optional" && (
            <Badge variant="outline" className="text-xs">Optional</Badge>
          )}
        </div>
        <div className="text-xs text-muted-foreground">{step.hint}</div>
      </div>

      <Button asChild size="sm" variant="outline">
        <Link href={step.href as Route}>{step.cta}</Link>
      </Button>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>Setup checklist</CardTitle>
            <p className="text-sm text-muted-foreground">
              {requiredTotalCount === 0
                ? "This channel has no required steps."
                : `A channel is ready once its ${requiredTotalCount} required ${
                    requiredTotalCount === 1 ? "step is" : "steps are"
                  } in place. Optional steps can be completed at any time, including after launch.`}
            </p>
          </div>
          {editable && editRows.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              Edit
            </Button>
          )}
        </div>
        <div className="text-xs text-muted-foreground">
          {requiredDoneCount} / {requiredTotalCount} required steps complete
        </div>
      </CardHeader>
      <CardContent className="flex flex-col">
        {required.map(stepRow)}
        {optional.length > 0 && (
          <>
            <div className="mt-4 border-t pt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Optional
            </div>
            {optional.map(stepRow)}
          </>
        )}
      </CardContent>

      <Drawer open={editOpen} onOpenChange={setEditOpen} direction="right">
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Edit setup checklist</DrawerTitle>
            <DrawerDescription>
              Choose which steps apply to this channel.
            </DrawerDescription>
          </DrawerHeader>
          <div className="flex flex-col gap-1 overflow-y-auto p-4 pt-0">
            {editRows.map((row) => (
              <label
                key={row.key}
                className={cn(
                  "flex items-start gap-3 rounded-md border-b p-2 last:border-b-0",
                  row.locked ? "opacity-60" : "cursor-pointer",
                )}
              >
                <Checkbox
                  className="mt-0.5"
                  checked={row.present}
                  disabled={pending || row.locked}
                  onCheckedChange={(checked) =>
                    run(
                      () =>
                        checked
                          ? addChannelSetupStepAction(campaignId, channelId, row.key)
                          : removeChannelSetupStepAction(campaignId, channelId, row.key),
                      checked ? `${row.title} added` : `${row.title} removed`,
                    )
                  }
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">
                    {row.title}
                    {row.locked && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        Locked
                      </span>
                    )}
                  </div>
                  {row.hint && (
                    <div className="text-xs text-muted-foreground">{row.hint}</div>
                  )}
                </div>
              </label>
            ))}
          </div>
        </DrawerContent>
      </Drawer>
    </Card>
  );
}
