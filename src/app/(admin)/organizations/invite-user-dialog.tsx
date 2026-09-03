"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { inviteUserAction } from "./actions";
import type { RoleCode } from "@/lib/auth/permissions";

type Props = {
  organizations: { id: string; name: string }[];
  roles: { code: string; name: string }[];
};

export function InviteUserDialog({ organizations, roles }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id ?? "");
  const [roleCode, setRoleCode] = useState(roles[0]?.code ?? "");

  function submit() {
    startTransition(async () => {
      const result = await inviteUserAction({
        email,
        organizationId,
        roleCode: roleCode as RoleCode,
      });
      if (result.ok) {
        toast.success("Invitation sent");
        setEmail("");
        setOpen(false);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Invite user</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a user</DialogTitle>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="invite-email">Email</FieldLabel>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="invite-organization">Organisation</FieldLabel>
            <Select value={organizationId} onValueChange={setOrganizationId}>
              <SelectTrigger id="invite-organization" className="w-full">
                <SelectValue placeholder="Organisation" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {organizations.map((organization) => (
                    <SelectItem key={organization.id} value={organization.id}>
                      {organization.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="invite-role">Role</FieldLabel>
            <Select value={roleCode} onValueChange={setRoleCode}>
              <SelectTrigger id="invite-role" className="w-full">
                <SelectValue placeholder="Role" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {roles.map((role) => (
                    <SelectItem key={role.code} value={role.code}>
                      {role.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button
            disabled={pending || email.trim() === "" || organizationId === "" || roleCode === ""}
            onClick={submit}
          >
            Send invitation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
