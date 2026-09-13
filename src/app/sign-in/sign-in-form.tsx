"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { authClient } from "@/lib/auth/client";
import { getPostSignInPortalAction } from "./actions";

export function SignInForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await authClient.signIn.email({
        email: String(formData.get("email") ?? ""),
        password: String(formData.get("password") ?? ""),
      });

      if (result.error !== null && result.error !== undefined) {
        // Deliberately generic: a distinct "no such account" message would let
        // an unauthenticated caller enumerate which addresses exist.
        setError("Those credentials are not valid.");
        return;
      }

      // The session cookie is set by the time signIn.email resolves, so this
      // server round-trip sees the new session. A partner-portal user lands
      // in the partner portal, a client-portal user lands in the client
      // portal; everyone else (admin today) keeps the existing default.
      const portalResult = await getPostSignInPortalAction();
      if (portalResult.ok && portalResult.data.portal === "partner") {
        router.push("/partner");
      } else if (portalResult.ok && portalResult.data.portal === "client") {
        router.push("/client");
      } else {
        router.push("/campaigns");
      }
      router.refresh();
    });
  }

  return (
    <form action={onSubmit}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <Field data-invalid={error !== null || undefined}>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            aria-invalid={error !== null || undefined}
          />
          <FieldError>{error}</FieldError>
        </Field>
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </FieldGroup>
    </form>
  );
}
