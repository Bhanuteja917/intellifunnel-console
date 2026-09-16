"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import type { ChannelSetupRequirement, ChannelSetupStepKey } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { ChannelStep } from "@/lib/channels/readiness";
import {
  addChannelSetupStepAction,
  removeChannelSetupStepAction,
  setChannelStepRequirementAction,
} from "./actions";

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

  const required = steps.filter((s) => s.requirement === "required");
  const optional = steps.filter((s) => s.requirement === "optional");

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

      {editable && !step.locked && (
        <>
          <Select
            value={step.requirement}
            disabled={pending}
            onValueChange={(next) =>
              run(
                () =>
                  setChannelStepRequirementAction(
                    campaignId,
                    channelId,
                    step.key,
                    next as ChannelSetupRequirement,
                  ),
                `${step.title} is now ${next}`,
              )
            }
          >
            <SelectTrigger className="w-28" aria-label={`${step.title} requirement`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="required">Required</SelectItem>
              <SelectItem value="optional">Optional</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            aria-label={`Remove ${step.title}`}
            onClick={() =>
              run(
                () => removeChannelSetupStepAction(campaignId, channelId, step.key),
                `${step.title} removed`,
              )
            }
          >
            Remove
          </Button>
        </>
      )}

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
          {editable && addableSteps.length > 0 && (
            <Select
              value=""
              disabled={pending}
              onValueChange={(key) =>
                run(
                  () =>
                    addChannelSetupStepAction(campaignId, channelId, key as ChannelSetupStepKey),
                  "Step added",
                )
              }
            >
              <SelectTrigger className="w-44" aria-label="Add setup step">
                <SelectValue placeholder="Add step" />
              </SelectTrigger>
              <SelectContent>
                {addableSteps.map((s) => (
                  <SelectItem key={s.key} value={s.key}>{s.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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
    </Card>
  );
}
