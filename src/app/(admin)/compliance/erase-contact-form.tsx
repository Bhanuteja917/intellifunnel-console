"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { eraseContactNowAction } from "./actions";

type Contact = { id: string; email: string; firstName: string | null; anonymisedAt: Date | null };

export function EraseContactForm({ initialEmail, contact }: { initialEmail: string; contact: Contact | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function search(formData: FormData) {
    const email = String(formData.get("email") ?? "").trim();
    router.push(email === "" ? "/compliance" : `/compliance?contactEmail=${encodeURIComponent(email)}`);
  }

  function erase() {
    if (contact === null) return;
    startTransition(async () => {
      const result = await eraseContactNowAction(contact.id);
      if (result.ok) toast.success("Contact's personal data erased");
      else toast.error(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <form action={search} className="flex gap-2">
        <Input name="email" defaultValue={initialEmail} placeholder="Search by email" className="max-w-sm" />
        <Button type="submit" variant="outline">Search</Button>
      </form>
      {initialEmail !== "" && contact === null && <p className="text-sm text-muted-foreground">No contact found for that email.</p>}
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
