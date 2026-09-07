"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { eraseContactNowAction } from "./actions";

type Contact = { id: string; email: string; firstName: string | null; anonymisedAt: Date | null };

export function EraseContactForm({ initialEmail, contact }: { initialEmail: string; contact: Contact | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // eraseContactNow scrubs the contact's email to a placeholder, so the
  // server-side refetch keyed on the *original* searched email will find
  // nothing post-erase. Track the erased contact locally so the confirmation
  // shows immediately instead of falling through to "No contact found".
  const [justErased, setJustErased] = useState<{ email: string; firstName: string | null } | null>(null);

  function search(formData: FormData) {
    const email = String(formData.get("email") ?? "").trim();
    router.push(email === "" ? "/compliance" : `/compliance?contactEmail=${encodeURIComponent(email)}`);
  }

  function erase() {
    if (contact === null) return;
    const erased = { email: contact.email, firstName: contact.firstName };
    startTransition(async () => {
      const result = await eraseContactNowAction(contact.id);
      if (result.ok) {
        toast.success("Contact's personal data erased");
        setJustErased(erased);
      } else {
        toast.error(result.error);
      }
    });
  }

  // Only trust the local confirmation while the search box still shows the
  // email that was just erased; a fresh search for a different email should
  // fall through to the normal contact/not-found rendering below.
  const showJustErased = justErased !== null && initialEmail === justErased.email;

  return (
    <div className="flex flex-col gap-4">
      <form action={search} className="flex gap-2">
        <Input name="email" defaultValue={initialEmail} placeholder="Search by email" className="max-w-sm" />
        <Button type="submit" variant="outline">Search</Button>
      </form>
      {showJustErased && (
        <div className="flex items-center gap-4 text-sm">
          <span>{justErased.firstName ?? "(no name)"} — {justErased.email}</span>
          <span className="text-muted-foreground">Personal data erased just now.</span>
        </div>
      )}
      {!showJustErased && initialEmail !== "" && contact === null && <p className="text-sm text-muted-foreground">No contact found for that email.</p>}
      {contact !== null && (
        <div className="flex items-center gap-4 text-sm">
          <span>{contact.firstName ?? "(no name)"} — {contact.email}</span>
          {contact.anonymisedAt !== null ? (
            <span className="text-muted-foreground">Already anonymized on {contact.anonymisedAt.toISOString().slice(0, 10)}</span>
          ) : (
            <Button variant="destructive" size="sm" disabled={pending} onClick={erase}>Erase personal data now</Button>
          )}
        </div>
      )}
    </div>
  );
}
