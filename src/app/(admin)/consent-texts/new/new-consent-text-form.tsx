"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { createConsentTextVersionAction } from "../actions";
import { cn } from "@/lib/utils";

export function NewConsentTextForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [language, setLanguage] = useState("en");
  const [effectiveFrom, setEffectiveFrom] = useState("");

  const canSubmit =
    name.trim() !== "" &&
    body.trim() !== "" &&
    language.trim() !== "" &&
    effectiveFrom !== "";

  function submit() {
    startTransition(async () => {
      // Convert the date string to a Date object at midnight UTC
      const date = new Date(effectiveFrom);
      const result = await createConsentTextVersionAction({
        name,
        body,
        language,
        effectiveFrom: date,
      });
      if (result.ok) {
        toast.success("Consent text created");
        router.push("/consent-texts");
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Consent Text Details</CardTitle>
          <CardDescription>Create a new version of a consent text</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="consent-name">Name *</FieldLabel>
              <Input
                id="consent-name"
                placeholder="e.g., EU GDPR consent"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="consent-body">Body *</FieldLabel>
              <textarea
                id="consent-body"
                placeholder="Enter the full text of the consent..."
                value={body}
                onChange={(event) => setBody(event.target.value)}
                rows={8}
                className={cn(
                  "w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40"
                )}
              />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="consent-language">Language *</FieldLabel>
                <Input
                  id="consent-language"
                  placeholder="e.g., en"
                  value={language}
                  onChange={(event) => setLanguage(event.target.value)}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="consent-effective-from">Effective From *</FieldLabel>
                <Input
                  id="consent-effective-from"
                  type="date"
                  value={effectiveFrom}
                  onChange={(event) => setEffectiveFrom(event.target.value)}
                />
              </Field>
            </div>
          </FieldGroup>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.push("/consent-texts")}>
          Cancel
        </Button>
        <Button disabled={pending || !canSubmit} onClick={submit}>
          Create Consent Text
        </Button>
      </div>
    </div>
  );
}
