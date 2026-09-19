"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { archiveOrganizationAction, unarchiveOrganizationAction, updateOrganizationAction } from "../../actions";

type Props = {
  organization: {
    id: string;
    name: string;
    legalName: string;
    country: string;
    isClient: boolean;
    isPartner: boolean;
    isInternal: boolean;
    defaultBillingCurrency: string;
    defaultPayoutCurrency: string;
    status: string;
  };
  currencies: string[];
};

export function EditOrganizationForm({ organization, currencies }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [archivePending, startArchiveTransition] = useTransition();
  const [name, setName] = useState(organization.name);
  const [legalName, setLegalName] = useState(organization.legalName);
  const [country, setCountry] = useState(organization.country);
  const [isClient, setIsClient] = useState(organization.isClient);
  const [isPartner, setIsPartner] = useState(organization.isPartner);
  const [isInternal, setIsInternal] = useState(organization.isInternal);
  const [defaultBillingCurrency, setDefaultBillingCurrency] = useState(organization.defaultBillingCurrency);
  const [defaultPayoutCurrency, setDefaultPayoutCurrency] = useState(organization.defaultPayoutCurrency);

  const canSubmit = name.trim() !== "" && (isClient || isPartner || isInternal);

  function submit() {
    startTransition(async () => {
      const result = await updateOrganizationAction(organization.id, {
        name,
        legalName: legalName.trim() === "" ? undefined : legalName,
        isClient,
        isPartner,
        isInternal,
        country: country.trim() === "" ? undefined : country,
        defaultBillingCurrency: defaultBillingCurrency === "" ? undefined : defaultBillingCurrency,
        defaultPayoutCurrency: defaultPayoutCurrency === "" ? undefined : defaultPayoutCurrency,
      });
      if (result.ok) {
        toast.success("Organisation updated");
        router.push(`/organizations/${organization.id}`);
      } else {
        toast.error(result.error);
      }
    });
  }

  function archive() {
    startArchiveTransition(async () => {
      const result = await archiveOrganizationAction(organization.id);
      if (result.ok) {
        toast.success("Organisation archived");
        router.push(`/organizations/${organization.id}`);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function unarchive() {
    startArchiveTransition(async () => {
      const result = await unarchiveOrganizationAction(organization.id);
      if (result.ok) {
        toast.success("Organisation unarchived");
        router.push(`/organizations/${organization.id}`);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Organisation details</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="org-name">Name *</FieldLabel>
              <Input id="org-name" value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="org-legal-name">Legal name</FieldLabel>
              <Input id="org-legal-name" value={legalName} onChange={(event) => setLegalName(event.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="org-country">Country</FieldLabel>
              <Input id="org-country" value={country} onChange={(event) => setCountry(event.target.value)} />
            </Field>
            <Field>
              <FieldLabel>Type *</FieldLabel>
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={isClient} onCheckedChange={(checked) => setIsClient(checked === true)} />
                  Client
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={isPartner} onCheckedChange={(checked) => setIsPartner(checked === true)} />
                  Partner
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={isInternal} onCheckedChange={(checked) => setIsInternal(checked === true)} />
                  Internal
                </label>
              </div>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Billing</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="org-billing-currency">Default billing currency</FieldLabel>
              <Select value={defaultBillingCurrency} onValueChange={setDefaultBillingCurrency}>
                <SelectTrigger id="org-billing-currency" className="w-full">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {currencies.map((code) => (
                      <SelectItem key={code} value={code}>
                        {code}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="org-payout-currency">Default payout currency</FieldLabel>
              <Select value={defaultPayoutCurrency} onValueChange={setDefaultPayoutCurrency}>
                <SelectTrigger id="org-payout-currency" className="w-full">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {currencies.map((code) => (
                      <SelectItem key={code} value={code}>
                        {code}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button disabled={pending || !canSubmit} onClick={submit}>
          Save changes
        </Button>
      </div>

      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-destructive">Danger zone</CardTitle>
        </CardHeader>
        <CardContent>
          <AlertDialog>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">
                  {organization.status === "archived" ? "Unarchive organisation" : "Archive organisation"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {organization.status === "archived"
                    ? "Restore access for this organisation's users."
                    : "Users lose access and pending invitations are disabled."}
                </p>
              </div>
              {organization.status === "archived" ? (
                <Button variant="outline" disabled={archivePending} onClick={unarchive}>
                  Unarchive
                </Button>
              ) : (
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" disabled={archivePending}>
                    Archive
                  </Button>
                </AlertDialogTrigger>
              )}
            </div>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Archive {organization.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  Users lose access and pending invitations are disabled. You can unarchive later.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={archive}>
                  Archive
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  );
}
