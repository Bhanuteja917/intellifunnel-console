"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireActor, toActionResult, type ActionResult } from "@/lib/auth/require";
import {
  addCampaignChannel,
  assertDraftAndAccessible,
  setIcpCriteria,
  setLeadFieldSpec,
  type IcpCriterionInput,
  type LeadFieldSpecInput,
} from "@/lib/campaigns/crud";
import { assertPermission } from "@/lib/auth/permissions";
import { getPublishedVersion } from "@/lib/channel-types/versions";
import { ValidationError } from "@/lib/errors";
import { superAdminRevertToDraft } from "@/lib/campaigns/state-machine";

export async function setIcpCriteriaAction(
  channelId: string,
  criteria: IcpCriterionInput[],
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    await setIcpCriteria(db, actor, channelId, criteria);
    revalidatePath(`/campaigns`);
    return null;
  });
}

export async function setLeadFieldSpecAction(
  channelId: string,
  fields: LeadFieldSpecInput[],
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    await setLeadFieldSpec(db, actor, channelId, fields);
    revalidatePath(`/campaigns`);
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
    setupSteps?: import("@/lib/channels/setup-steps").StepOverride[];
  },
): Promise<ActionResult<{ id: string }>> {
  return toActionResult(async () => {
    const actor = await requireActor();

    // Authorise before reading anything: a caller without campaign:write, or
    // without access to this campaign's organisation, is turned away before the
    // channel-type lookups below (which check nothing campaign-specific).
    // assertDraftAndAccessible also gives a clean NotFoundError for an unknown
    // campaign id, and returns the row we need for `currency`.
    // addCampaignChannel re-checks both internally (defence in depth).
    assertPermission(actor, "campaign:write");
    const campaign = await assertDraftAndAccessible(db, actor, campaignId);

    const channelType = await db.channelType.findUnique({ where: { id: input.channelTypeId } });
    if (channelType === null) throw new ValidationError("Channel type not found");
    if (channelType.currentVersion === 0) {
      throw new ValidationError(`${channelType.name} has no published version yet`);
    }
    const version = await getPublishedVersion(db, input.channelTypeId, channelType.currentVersion);

    const channel = await addCampaignChannel(db, actor, campaignId, {
      channelTypeVersionId: version.id,
      contractedQuantity: input.contractedQuantity,
      clientUnitPrice: input.clientUnitPrice,
      costBudget: input.costBudget,
      currency: campaign.currency,
      startDate: new Date(input.startDate),
      endDate: new Date(input.endDate),
      setupSteps: input.setupSteps,
    });
    revalidatePath(`/campaigns/${campaignId}`);
    return { id: channel.id };
  });
}

export async function superAdminRevertToDraftAction(
  campaignId: string,
  reason?: string,
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    await superAdminRevertToDraft(db, actor, campaignId, reason);
    revalidatePath(`/campaigns/${campaignId}`);
    return null;
  });
}
