import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import { assertPermission } from "@/lib/auth/permissions";
import { getCampaignForActor } from "@/lib/campaigns/crud";
import { NotFoundError } from "@/lib/errors";
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

  const leadFieldKeys = campaign.leadFieldSpecs.map((spec) => ({
    fieldKey: spec.fieldKey,
    label: spec.label,
    isRequired: spec.isRequired,
  }));

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

      <UploadForm campaignId={campaign.id} channels={channels} leadFieldKeys={leadFieldKeys} />
    </div>
  );
}
