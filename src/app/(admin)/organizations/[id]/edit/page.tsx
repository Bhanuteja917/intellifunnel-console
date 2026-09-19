import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import { assertOrganizationAccess, assertPermission } from "@/lib/auth/permissions";
import { CURRENCY_EXPONENTS } from "@/lib/money/currency";
import { EditOrganizationForm } from "./edit-organization-form";

export default async function EditOrganizationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor();
  assertPermission(actor, "organization:write");
  assertOrganizationAccess(actor, id);

  const organization = await db.organization.findUnique({ where: { id } });
  if (organization === null || organization.deletedAt !== null) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <Link
          href={`/organizations/${id}`}
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to {organization.name}
        </Link>
        <div>
          <h1 className="text-2xl font-semibold">Edit organisation</h1>
        </div>
      </div>

      <EditOrganizationForm
        organization={{
          id: organization.id,
          name: organization.name,
          legalName: organization.legalName ?? "",
          country: organization.country ?? "",
          isClient: organization.isClient,
          isPartner: organization.isPartner,
          isInternal: organization.isInternal,
          defaultBillingCurrency: organization.defaultBillingCurrency ?? "",
          defaultPayoutCurrency: organization.defaultPayoutCurrency ?? "",
          status: organization.status,
        }}
        currencies={Object.keys(CURRENCY_EXPONENTS)}
      />
    </div>
  );
}
