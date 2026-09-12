import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireActor } from "@/lib/auth/require";
import { assertPermission } from "@/lib/auth/permissions";
import { CURRENCY_EXPONENTS } from "@/lib/money/currency";
import { CreateOrganizationForm } from "./create-organization-form";

export default async function NewOrganizationPage() {
  const actor = await requireActor();
  assertPermission(actor, "organization:write");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <Link href="/organizations" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" />
          Back to Organisations
        </Link>
        <div>
          <h1 className="text-2xl font-semibold">Create organisation</h1>
        </div>
      </div>

      <CreateOrganizationForm currencies={Object.keys(CURRENCY_EXPONENTS)} />
    </div>
  );
}
