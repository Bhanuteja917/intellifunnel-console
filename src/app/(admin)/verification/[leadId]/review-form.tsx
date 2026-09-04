"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { TeleVerificationInput } from "@/lib/leads/verification";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { acceptLeadAction, rejectLeadAction } from "../actions";

type RejectReason = { id: string; code: string; label: string };

type Props = {
  leadId: string;
  requiresTeleVerification: boolean;
  rejectReasons: RejectReason[];
};

export function ReviewForm({ leadId, requiresTeleVerification, rejectReasons }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Tele-verification fields — per Task 5's Step 2.5, both Accept and Reject
  // can carry these (a reviewer rejecting a lead may still be recording a
  // failed call as the actual reason), so they're never hidden behind
  // "only for Accept".
  const [callSystem, setCallSystem] = useState("");
  const [callReferenceId, setCallReferenceId] = useState("");
  const [callOccurredAt, setCallOccurredAt] = useState("");
  const [callDurationSeconds, setCallDurationSeconds] = useState("");
  const [notes, setNotes] = useState("");
  const [outcome, setOutcome] = useState<"pass" | "fail">("pass");

  const [rejectReasonCode, setRejectReasonCode] = useState<string>(rejectReasons[0]?.code ?? "");

  // Tele fields are optional on both actions (a plain manual decision is
  // still valid) — only build the payload once the reviewer has actually
  // started filling in the call system or reference. Leaving both blank
  // sends `undefined`, letting the server fall back to a manual outcome; if
  // the channel requires tele-verification to accept, the server enforces
  // that and its error surfaces through the toast below.
  function buildTele(): TeleVerificationInput | undefined {
    const trimmedCallSystem = callSystem.trim();
    const trimmedCallReferenceId = callReferenceId.trim();
    if (trimmedCallSystem === "" && trimmedCallReferenceId === "") return undefined;

    return {
      callSystem: trimmedCallSystem,
      callReferenceId: trimmedCallReferenceId,
      callOccurredAt: callOccurredAt === "" ? undefined : new Date(callOccurredAt),
      callDurationSeconds: callDurationSeconds === "" ? undefined : Number(callDurationSeconds),
      notes: notes.trim() === "" ? undefined : notes.trim(),
      outcome,
    };
  }

  function accept() {
    startTransition(async () => {
      const result = await acceptLeadAction(leadId, buildTele());
      if (result.ok) {
        // A failed tele-verification rejects the lead despite the Accept
        // button, so report what the server actually did.
        toast.success(result.data.decision === "accept" ? "Lead accepted" : "Lead rejected");
        router.push("/verification");
      } else {
        // Covers the "already decided" ValidationError from
        // decideLeadVerification (double-submit, stale tab, etc.) the same
        // way as any other action error — no special-casing needed here.
        toast.error(result.error);
      }
    });
  }

  function reject() {
    if (rejectReasonCode === "") {
      toast.error("Select a reject reason before rejecting.");
      return;
    }
    startTransition(async () => {
      const result = await rejectLeadAction(leadId, rejectReasonCode, buildTele());
      if (result.ok) {
        toast.success(result.data.decision === "accept" ? "Lead accepted" : "Lead rejected");
        router.push("/verification");
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      {requiresTeleVerification && (
        <Card>
          <CardHeader>
            <CardTitle>Tele-verification</CardTitle>
            <CardDescription>
              This channel requires a completed call before a lead can be accepted. A reject can
              optionally record the call that led to it too.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <div className="grid grid-cols-2 gap-4">
                <Field>
                  <FieldLabel htmlFor="tele-call-system">Call system *</FieldLabel>
                  <Input
                    id="tele-call-system"
                    value={callSystem}
                    onChange={(event) => setCallSystem(event.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="tele-call-reference">Call reference ID *</FieldLabel>
                  <Input
                    id="tele-call-reference"
                    value={callReferenceId}
                    onChange={(event) => setCallReferenceId(event.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="tele-call-occurred-at">Call occurred at</FieldLabel>
                  <Input
                    id="tele-call-occurred-at"
                    type="datetime-local"
                    value={callOccurredAt}
                    onChange={(event) => setCallOccurredAt(event.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="tele-call-duration">Call duration (seconds)</FieldLabel>
                  <Input
                    id="tele-call-duration"
                    type="number"
                    min={0}
                    value={callDurationSeconds}
                    onChange={(event) => setCallDurationSeconds(event.target.value)}
                  />
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="tele-notes">Notes</FieldLabel>
                <Input id="tele-notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
              </Field>
              <Field>
                <FieldLabel>Call outcome</FieldLabel>
                <div className="flex items-center gap-4 text-sm">
                  <label className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      name="tele-outcome"
                      value="pass"
                      checked={outcome === "pass"}
                      onChange={() => setOutcome("pass")}
                    />
                    Pass
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      name="tele-outcome"
                      value="fail"
                      checked={outcome === "fail"}
                      onChange={() => setOutcome("fail")}
                    />
                    Fail
                  </label>
                </div>
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Decision</CardTitle>
          <CardDescription>
            Accept moves the lead to the client-visible queue; reject requires picking a reason.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="reject-reason">Reject reason</FieldLabel>
              <Select value={rejectReasonCode} onValueChange={setRejectReasonCode}>
                <SelectTrigger id="reject-reason" className="w-full">
                  <SelectValue placeholder="Select a reason..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {rejectReasons.map((reason) => (
                      <SelectItem key={reason.id} value={reason.code}>
                        {reason.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="destructive" disabled={pending} onClick={reject}>
          Reject
        </Button>
        <Button disabled={pending} onClick={accept}>
          Accept
        </Button>
      </div>
    </div>
  );
}
