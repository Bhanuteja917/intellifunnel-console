import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import { assertPermission } from "@/lib/auth/permissions";
import { CURRENCY_EXPONENTS } from "@/lib/money/currency";
import { NewCampaignForm } from "./new-campaign-form";

export default async function NewCampaignPage() {
  const actor = await requireActor();
  assertPermission(actor, "campaign:write");

  const clientOrganizations = await db.organization.findMany({
    where: { deletedAt: null, isClient: true, status: "active" },
    orderBy: { name: "asc" },
  });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-4">
        <Link href="/campaigns" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" />
          Back to Campaigns
        </Link>
        <div>
          <h1 className="text-2xl font-semibold">New Campaign</h1>
          <p className="text-muted-foreground">Create a new marketing campaign</p>
        </div>
      </div>

      <NewCampaignForm
        clientOrganizations={clientOrganizations.map((organization) => ({
          id: organization.id,
          name: organization.name,
        }))}
        currencies={Object.keys(CURRENCY_EXPONENTS)}
      />
    </div>
  );
}
