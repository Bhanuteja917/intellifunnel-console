import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import { getCampaignForActor } from "@/lib/campaigns/crud";
import { hasPermission } from "@/lib/auth/permissions";
import { NotFoundError } from "@/lib/errors";
import { NewChannelForm } from "./new-channel-form";

export default async function NewChannelPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireActor();

  let campaign;
  try {
    campaign = await getCampaignForActor(db, actor, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  if (!hasPermission(actor, "campaign:write") || campaign.status !== "draft") {
    redirect(`/campaigns/${id}`);
  }

  const channelTypes = await db.channelType.findMany({
    where: { isActive: true, currentVersion: { gt: 0 } },
    select: { id: true, name: true, requiresAsset: true },
    orderBy: { name: "asc" },
  });

  if (channelTypes.length === 0) redirect(`/campaigns/${id}`);

  return (
    <NewChannelForm
      campaignId={id}
      campaignCurrency={campaign.currency}
      campaignStartDate={campaign.startDate.toISOString().slice(0, 10)}
      campaignEndDate={campaign.endDate.toISOString().slice(0, 10)}
      channelTypes={channelTypes}
    />
  );
}
