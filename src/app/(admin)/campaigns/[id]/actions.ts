"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireActor, toActionResult, type ActionResult } from "@/lib/auth/require";
import {
  addCampaignChannel,
  setIcpCriteria,
  setLeadFieldSpec,
  type IcpCriterionInput,
  type LeadFieldSpecInput,
} from "@/lib/campaigns/crud";
import { getPublishedVersion } from "@/lib/channel-types/versions";
import { ValidationError } from "@/lib/errors";

export async function setIcpCriteriaAction(
  campaignId: string,
  criteria: IcpCriterionInput[],
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    await setIcpCriteria(db, actor, campaignId, criteria);
    revalidatePath(`/campaigns/${campaignId}`);
    return null;
  });
}

export async function setLeadFieldSpecAction(
  campaignId: string,
  fields: LeadFieldSpecInput[],
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    await setLeadFieldSpec(db, actor, campaignId, fields);
    revalidatePath(`/campaigns/${campaignId}`);
    return null;
  });
}

export async function addCampaignChannelAction(
  campaignId: string,
  input: {
    channelTypeId: string;
    contractedQuantity: number;
    clientUnitPrice: string;
    costBudget?: string;
    startDate: string;
    endDate: string;
  },
): Promise<ActionResult<{ id: string }>> {
  return toActionResult(async () => {
    const actor = await requireActor();

    const channelType = await db.channelType.findUnique({ where: { id: input.channelTypeId } });
    if (channelType === null) throw new ValidationError("Channel type not found");
    if (channelType.currentVersion === 0) {
      throw new ValidationError(`${channelType.name} has no published version yet`);
    }
    const version = await getPublishedVersion(db, input.channelTypeId, channelType.currentVersion);

    const campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });

    const channel = await addCampaignChannel(db, actor, campaignId, {
      channelTypeVersionId: version.id,
      contractedQuantity: input.contractedQuantity,
      clientUnitPrice: input.clientUnitPrice,
      costBudget: input.costBudget,
      currency: campaign.currency,
      startDate: new Date(input.startDate),
      endDate: new Date(input.endDate),
    });
    revalidatePath(`/campaigns/${campaignId}`);
    return { id: channel.id };
  });
}
