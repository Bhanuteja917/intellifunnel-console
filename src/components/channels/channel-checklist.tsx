"use client";

import Link from "next/link";
import type { Route } from "next";
import { CheckCircle2, Circle, ListChecks } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { ChannelReadiness } from "@/lib/channels/readiness";

export function ChannelChecklist({
  readiness,
}: {
  campaignId: string;
  channelId: string;
  readiness: ChannelReadiness;
}) {
  const { steps, requiredDoneCount, requiredTotalCount } = readiness;
  const allDone = requiredDoneCount === requiredTotalCount && requiredTotalCount > 0;

  const trigger = allDone ? (
    <Badge className="cursor-pointer gap-1.5">
      <CheckCircle2 className="h-3.5 w-3.5" />
      Ready
    </Badge>
  ) : (
    <Badge variant="outline" className="cursor-pointer gap-1.5 bg-muted/40">
      <Circle className="h-3.5 w-3.5 text-muted-foreground" />
      {requiredDoneCount}/{requiredTotalCount}
    </Badge>
  );

  if (steps.length === 0) {
    return <Badge variant="outline">No steps</Badge>;
  }

  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Channel setup</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 pt-2">
          {steps.map((step) => (
            <div
              key={step.key}
              className="flex items-start gap-3 rounded-lg border bg-card p-4"
            >
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-muted">
                <ListChecks className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="flex flex-1 flex-col gap-1">
                <div className={`text-sm font-medium leading-none ${step.done ? "text-muted-foreground line-through" : ""}`}>
                  {step.title}
                  {step.requirement === "required" && !step.done && (
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">(required)</span>
                  )}
                </div>
                {!step.done && (
                  <p className="text-xs text-muted-foreground">{step.hint}</p>
                )}
              </div>
              <div className="shrink-0">
                {step.done ? (
                  <CheckCircle2 className="h-5 w-5 text-primary" />
                ) : (
                  <Button asChild size="sm" variant="outline">
                    <Link href={step.href as Route}>
                      {step.cta}
                    </Link>
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
