"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { authClient } from "@/lib/auth/client";
import { acceptInvitationAction } from "./actions";

export function AcceptForm({ token, email }: { token: string; email: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    setError(null);
    const password = String(formData.get("password") ?? "");
    startTransition(async () => {
      const result = await acceptInvitationAction({
        token,
        name: String(formData.get("name") ?? ""),
        password,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }

      // The account now exists but the browser holds no session yet: a server
      // action cannot set Better Auth's session cookie, only its route handler
      // can. So sign in with the credential just created, which is what makes
      // the redirect below land on an authenticated page instead of tripping
      // getCurrentActor's "Not authenticated".
      const signIn = await authClient.signIn.email({
        email: result.data.email,
        password,
      });
      if (signIn.error !== null && signIn.error !== undefined) {
        toast.success("Account created — please sign in");
        router.push("/sign-in");
        return;
      }

      toast.success("Account created");
      router.push("/campaigns");
    });
  }

  return (
    <form action={onSubmit}>
      <FieldGroup>
        {/* AUTH-4: the invited address is fixed and cannot be changed at acceptance. */}
        <Field>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input id="email" value={email} disabled readOnly />
        </Field>
        <Field>
          <FieldLabel htmlFor="name">Your name</FieldLabel>
          <Input id="name" name="name" required />
        </Field>
        <Field data-invalid={error !== null || undefined}>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <Input
            id="password"
            name="password"
            type="password"
            required
            minLength={12}
            aria-invalid={error !== null || undefined}
          />
          <FieldError>{error}</FieldError>
        </Field>
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Creating your account…" : "Accept invitation"}
        </Button>
      </FieldGroup>
    </form>
  );
}
