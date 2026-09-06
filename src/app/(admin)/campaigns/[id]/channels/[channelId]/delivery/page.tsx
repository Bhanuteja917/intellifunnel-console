import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import { assertPermission } from "@/lib/auth/permissions";
import { getCampaignForActor } from "@/lib/campaigns/crud";
import { getDeliveryConfigForChannel } from "@/lib/delivery/config";
import { listDeliveryRunsForChannel } from "@/lib/delivery/runs";
import { availableSourceFields, type FieldMappingEntry } from "@/lib/delivery/field-mapping";
import { NotFoundError } from "@/lib/errors";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeliveryConfigForm } from "./delivery-config-form";
import { RunLogTable } from "./run-log-table";

export default async function ChannelDeliveryPage({
  params,
}: {
  params: Promise<{ id: string; channelId: string }>;
}) {
  const { id, channelId } = await params;
  const actor = await requireActor();
  assertPermission(actor, "delivery:read");

  let campaign;
  try {
    campaign = await getCampaignForActor(db, actor, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const channel = campaign.channels.find((c) => c.id === channelId);
  if (channel === undefined) notFound();

  const [config, runs] = await Promise.all([
    getDeliveryConfigForChannel(db, actor, channelId),
    listDeliveryRunsForChannel(db, actor, channelId),
  ]);

  const sourceFields = availableSourceFields(campaign.leadFieldSpecs.map((f) => f.fieldKey));

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={`/campaigns/${campaign.id}` as Route}
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to campaign
      </Link>

      <DeliveryConfigForm
        campaignId={campaign.id}
        campaignChannelId={channelId}
        availableSourceFields={sourceFields}
        initial={
          config === null
            ? null
            : {
                method: config.method,
                status: config.status,
                webhookUrl: config.webhookUrl,
                csvScheduleCron: config.csvScheduleCron,
                fieldMapping: config.fieldMappingJson as unknown as FieldMappingEntry[],
              }
        }
      />

      <Card>
        <CardHeader><CardTitle>Delivery run log</CardTitle></CardHeader>
        <CardContent>
          <RunLogTable campaignId={campaign.id} campaignChannelId={channelId} runs={runs} />
        </CardContent>
      </Card>
    </div>
  );
}
