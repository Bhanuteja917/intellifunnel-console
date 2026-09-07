"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { createDoNotContactEntryAction } from "./actions";

type Props = { clientOrganizations: { id: string; name: string }[] };

export function AddDncEntryDialog({ clientOrganizations }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [clientOrganizationId, setClientOrganizationId] = useState("");
  const [type, setType] = useState<"email" | "domain" | "phone">("email");
  const [rawValue, setRawValue] = useState("");
  const [reason, setReason] = useState("");

  const canSubmit = clientOrganizationId !== "" && rawValue.trim() !== "";

  function reset() {
    setClientOrganizationId("");
    setType("email");
    setRawValue("");
    setReason("");
  }

  function submit() {
    startTransition(async () => {
      const result = await createDoNotContactEntryAction({
        clientOrganizationId, type, rawValue,
        reason: reason.trim() === "" ? undefined : reason,
      });
      if (result.ok) {
        toast.success("Do-not-contact entry added");
        reset();
        setOpen(false);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Add DNC entry</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a do-not-contact entry</DialogTitle>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel>Client organisation</FieldLabel>
            <Select value={clientOrganizationId} onValueChange={setClientOrganizationId}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Select a client" /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {clientOrganizations.map((org) => (
                    <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel>Type</FieldLabel>
            <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="domain">Domain</SelectItem>
                  <SelectItem value="phone">Phone</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="dnc-value">Value</FieldLabel>
            <Input id="dnc-value" value={rawValue} onChange={(e) => setRawValue(e.target.value)} placeholder="blocked@example.com" />
          </Field>
          <Field>
            <FieldLabel htmlFor="dnc-reason">Reason (optional)</FieldLabel>
            <Input id="dnc-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button disabled={!canSubmit || pending} onClick={submit}>Add</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
