import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import { assertPermission } from "@/lib/auth/permissions";
import { getCampaignForActor } from "@/lib/campaigns/crud";
import { NotFoundError } from "@/lib/errors";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NewPlacementForm } from "./new-placement-form";

export default async function NewPlacementPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; channelId: string }>;
  searchParams: Promise<{ assetId?: string }>;
}) {
  const { id, channelId } = await params;
  const { assetId } = await searchParams;
  const actor = await requireActor();
  assertPermission(actor, "asset:write");

  let campaign;
  try {
    campaign = await getCampaignForActor(db, actor, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const channel = campaign.channels.find((c) => c.id === channelId);
  if (channel === undefined) notFound();

  // An asset must itself be active to be placed — matching how a draft
  // campaign channel or draft asset shouldn't be placeable yet. Scoped to
  // the campaign's own client organisation, per Global Constraints (assets
  // never cross organisation boundaries).
  const assets = await db.asset.findMany({
    where: { ownerOrganizationId: campaign.clientOrganizationId, status: "active" },
    orderBy: { name: "asc" },
  });

  const selectedAssetId = assetId !== undefined && assets.some((asset) => asset.id === assetId) ? assetId : "";

  const versions = selectedAssetId !== ""
    ? await db.assetVersion.findMany({ where: { assetId: selectedAssetId }, orderBy: { version: "desc" } })
    : [];

  const consentTextVersions = await db.consentTextVersion.findMany({
    orderBy: [{ name: "asc" }, { version: "desc" }],
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <Link
          href={`/campaigns/${campaign.id}/channels/${channel.id}?tab=placements` as Route}
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to placements
        </Link>
        <div>
          <h1 className="text-2xl font-semibold">New placement</h1>
          <p className="text-muted-foreground">
            Attach an asset version to this channel with a landing page and form.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Select asset</CardTitle>
        </CardHeader>
        <CardContent>
          {/* A GET form reload — simplest way to cascade the version picker
             to the chosen asset without client-side state duplicating the
             server's asset/version data (mirrors the verification queue's
             campaign filter). Omitting `action` submits back to this same
             page with the query string appended. */}
          <form className="flex items-end gap-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="assetId" className="text-sm text-muted-foreground">
                Asset *
              </label>
              <select
                id="assetId"
                name="assetId"
                defaultValue={selectedAssetId}
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
              >
                <option value="">Select an asset…</option>
                {assets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.name}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="h-9 rounded-md border border-input px-3 text-sm hover:bg-muted">
              Load versions
            </button>
          </form>
          {assets.length === 0 && (
            <p className="mt-2 text-sm text-muted-foreground">
              No active assets found for this campaign&apos;s organisation.
            </p>
          )}
        </CardContent>
      </Card>

      {selectedAssetId !== "" && (
        <NewPlacementForm
          campaignId={campaign.id}
          campaignChannelId={channel.id}
          assetId={selectedAssetId}
          versions={versions.map((version) => ({
            id: version.id,
            version: version.version,
            fileName: version.fileName,
          }))}
          consentTextVersions={consentTextVersions.map((consentTextVersion) => ({
            id: consentTextVersion.id,
            name: consentTextVersion.name,
            version: consentTextVersion.version,
          }))}
        />
      )}
    </div>
  );
}
