import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireActor } from "@/lib/auth/require";
import { assertPermission } from "@/lib/auth/permissions";
import { NewConsentTextForm } from "./new-consent-text-form";

export default async function NewConsentTextPage() {
  const actor = await requireActor();
  assertPermission(actor, "asset:write");

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-4">
        <Link href="/consent-texts" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" />
          Back to Consent Texts
        </Link>
        <div>
          <h1 className="text-2xl font-semibold">New Consent Text</h1>
          <p className="text-muted-foreground">Create a new version of a consent text</p>
        </div>
      </div>

      <NewConsentTextForm />
    </div>
  );
}
