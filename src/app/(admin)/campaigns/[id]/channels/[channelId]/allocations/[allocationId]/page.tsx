import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import { assertPermission } from "@/lib/auth/permissions";
import { getCampaignForActor } from "@/lib/campaigns/crud";
import { fromMinorUnits } from "@/lib/money/currency";
import { NotFoundError } from "@/lib/errors";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AllocationStatusControl } from "../allocation-status-control";
import { EditAllocationForm } from "./edit-allocation-form";

export default async function EditAllocationPage({
  params,
}: {
  params: Promise<{ id: string; channelId: string; allocationId: string }>;
}) {
  const { id, channelId, allocationId } = await params;
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

  const allocation = await db.partnerAllocation.findUnique({
    where: { id: allocationId },
    include: { partnerOrganization: { select: { name: true } } },
  });
  if (allocation === null || allocation.campaignChannelId !== channelId) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <Link
          href={`/campaigns/${campaign.id}/channels/${channel.id}?tab=allocations` as Route}
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to allocations
        </Link>
        <div>
          <h1 className="text-2xl font-semibold">{allocation.partnerOrganization.name}</h1>
          <p className="text-muted-foreground">Edit this partner allocation.</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
        </CardHeader>
        <CardContent>
          <AllocationStatusControl
            campaignId={campaign.id}
            campaignChannelId={channel.id}
            allocationId={allocation.id}
            status={allocation.status}
          />
        </CardContent>
      </Card>

      <EditAllocationForm
        campaignId={campaign.id}
        campaignChannelId={channel.id}
        allocationId={allocation.id}
        allocatedQuantity={allocation.allocatedQuantity}
        payoutRate={fromMinorUnits(allocation.payoutRateMinor, allocation.payoutCurrency)}
        payoutCurrency={allocation.payoutCurrency}
        startDate={allocation.startDate.toISOString().slice(0, 10)}
        endDate={allocation.endDate.toISOString().slice(0, 10)}
        revealClientIdentity={allocation.revealClientIdentity}
      />
    </div>
  );
}
