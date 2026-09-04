import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import { assertPermission } from "@/lib/auth/permissions";
import { NewAssetForm } from "./new-asset-form";

export default async function NewAssetPage() {
  const actor = await requireActor();
  assertPermission(actor, "asset:write");

  // Assets are owned per Global Constraints by the client organisation they
  // belong to — same org-picker query shape as campaigns/new/page.tsx.
  const clientOrganizations = await db.organization.findMany({
    where: { deletedAt: null, isClient: true, status: "active" },
    orderBy: { name: "asc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <Link href="/assets" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" />
          Back to Assets
        </Link>
        <div>
          <h1 className="text-2xl font-semibold">New Asset</h1>
          <p className="text-muted-foreground">Register a new asset before uploading its first version</p>
        </div>
      </div>

      <NewAssetForm
        clientOrganizations={clientOrganizations.map((organization) => ({
          id: organization.id,
          name: organization.name,
        }))}
      />
    </div>
  );
}
