import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import { assertPermission } from "@/lib/auth/permissions";
import { getCampaignForActor } from "@/lib/campaigns/crud";
import { NotFoundError } from "@/lib/errors";
import { NewAllocationForm } from "./new-allocation-form";

export default async function NewAllocationPage({
  params,
}: {
  params: Promise<{ id: string; channelId: string }>;
}) {
  const { id, channelId } = await params;
  const actor = await requireActor();
  assertPermission(actor, "allocation:write");

  let campaign;
  try {
    campaign = await getCampaignForActor(db, actor, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const channel = campaign.channels.find((c) => c.id === channelId);
  if (channel === undefined) notFound();

  const partnerOrgs = await db.organization.findMany({
    where: { isPartner: true, status: "active", deletedAt: null },
    select: { id: true, name: true, defaultPayoutCurrency: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <Link
          href={`/campaigns/${campaign.id}/channels/${channel.id}/allocations` as Route}
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to allocations
        </Link>
        <div>
          <h1 className="text-2xl font-semibold">New allocation</h1>
          <p className="text-muted-foreground">Allocate a quantity of this channel to a partner organisation.</p>
        </div>
      </div>

      <NewAllocationForm
        campaignId={campaign.id}
        campaignChannelId={channel.id}
        partnerOrgs={partnerOrgs}
      />
    </div>
  );
}
