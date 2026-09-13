import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import { assertPermission } from "@/lib/auth/permissions";
import { getCampaignForActor } from "@/lib/campaigns/crud";
import { NotFoundError } from "@/lib/errors";
import { Card, CardContent } from "@/components/ui/card";
import { UploadForm } from "./upload-form";

export default async function UploadLeadsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor();
  assertPermission(actor, "campaign:write");

  let campaign;
  try {
    campaign = await getCampaignForActor(db, actor, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const channels = campaign.channels.map((channel) => {
    const definition = channel.channelTypeVersion.definitionJson as { name?: string; code?: string };
    const label = `${definition.name ?? definition.code} — ${channel.startDate.toISOString().slice(0, 10)}..${channel.endDate.toISOString().slice(0, 10)}`;
    return { id: channel.id, label };
  });

  const allocations = await db.partnerAllocation.findMany({
    where: { campaignChannelId: { in: campaign.channels.map((c) => c.id) } },
    include: { partnerOrganization: { select: { id: true, name: true } } },
  });
  const partnersByChannelId: Record<string, { id: string; name: string }[]> = {};
  for (const allocation of allocations) {
    (partnersByChannelId[allocation.campaignChannelId] ??= []).push({
      id: allocation.partnerOrganizationId,
      name: allocation.partnerOrganization.name,
    });
  }

  // Aggregate lead field specs from all channels (dedup by fieldKey using first occurrence)
  const channelIds = campaign.channels.map((c) => c.id);
  const allLeadFieldSpecs = channelIds.length > 0
    ? await db.leadFieldSpec.findMany({
        where: { campaignChannelId: { in: channelIds } },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const seenKeys = new Set<string>();
  const dedupedSpecs = allLeadFieldSpecs.filter((s) => {
    if (seenKeys.has(s.fieldKey)) return false;
    seenKeys.add(s.fieldKey);
    return true;
  });

  const leadFieldKeys = dedupedSpecs.map((spec) => ({
    fieldKey: spec.fieldKey,
    label: spec.label,
    isRequired: spec.isRequired,
  }));

  // Global Constraints: a campaign with no email-keyed field spec cannot use
  // lead intake at all, and the upload UI must say so upfront — not after the
  // operator has already picked a file and mapped every column.
  const hasEmailSpec = dedupedSpecs.some((s) => s.fieldKey.toLowerCase() === "email");
  const hasChannels = campaign.channels.length > 0;
  const hasFieldSpecs = dedupedSpecs.length > 0;
  const blockedReason = !hasFieldSpecs
    ? "This campaign has no lead field specs configured. Configure field mappings on a channel before uploading leads."
    : !hasEmailSpec
      ? "This campaign has no 'email' lead field configured. Add one on a channel page before uploading leads."
      : !hasChannels
        ? "This campaign has no channels configured. Add a channel on the campaign detail page before uploading leads."
        : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <Link
          href={`/campaigns/${campaign.id}`}
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to campaign
        </Link>
        <div>
          <h1 className="text-2xl font-semibold">Upload leads</h1>
          <p className="text-muted-foreground">
            Upload a CSV of leads for this campaign and map its columns to the campaign&apos;s lead fields.
          </p>
        </div>
      </div>

      {blockedReason !== null ? (
        <Card>
          <CardContent className="text-muted-foreground">
            <p>{blockedReason}</p>
            <Link href={`/campaigns/${campaign.id}`} className="text-sm text-primary underline">
              Back to campaign
            </Link>
          </CardContent>
        </Card>
      ) : (
        <UploadForm
          campaignId={campaign.id}
          channels={channels}
          leadFieldKeys={leadFieldKeys}
          partnersByChannelId={partnersByChannelId}
        />
      )}
    </div>
  );
}
