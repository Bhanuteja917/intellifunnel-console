"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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
import { createOrganizationAction } from "../../actions";

type Props = {
  currencies: string[];
};

export function CreateOrganizationForm({ currencies }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [country, setCountry] = useState("");
  const [isClient, setIsClient] = useState(false);
  const [isPartner, setIsPartner] = useState(false);
  const [isInternal, setIsInternal] = useState(false);
  const [defaultBillingCurrency, setDefaultBillingCurrency] = useState("");
  const [defaultPayoutCurrency, setDefaultPayoutCurrency] = useState("");

  const canSubmit = name.trim() !== "" && (isClient || isPartner || isInternal);

  function submit() {
    startTransition(async () => {
      const result = await createOrganizationAction({
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
        toast.success("Organisation created");
        router.push(`/organizations/${result.data.id}`);
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
          Create organisation
        </Button>
      </div>
    </div>
  );
}
