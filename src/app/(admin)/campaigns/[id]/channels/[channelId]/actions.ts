"use server";

import { revalidatePath } from "next/cache";
import type { CampaignChannelStatus, ChannelSetupRequirement, ChannelSetupStepKey } from "@prisma/client";
import { db } from "@/lib/db";
import { requireActor, toActionResult, type ActionResult } from "@/lib/auth/require";
import { deleteCampaignChannel, setChannelStatus, updateCampaignChannel } from "@/lib/campaigns/channels";
import { submitChannelForApproval, withdrawChannelFromApproval } from "@/lib/campaigns/state-machine";
import {
  addChannelSetupStep,
  removeChannelSetupStep,
  setChannelStepRequirement,
} from "@/lib/channels/setup-steps";
import {
  addTargetAccountEntry,
  detachTargetAccountList,
  importAndAttachTargetAccountList,
  removeTargetAccountEntry,
  type AddTargetAccountEntryInput,
} from "@/lib/lists/target-accounts";
import {
  addSuppressionEntry,
  detachSuppressionList,
  importAndAttachSuppressionList,
  removeSuppressionEntry,
  type AddSuppressionEntryInput,
} from "@/lib/lists/suppression";

export async function updateChannelAction(input: {
  campaignId: string; // only for revalidatePath
  campaignChannelId: string;
  contractedQuantity: number;
  clientUnitPrice: string;
  costBudget?: string;
  currency: string;
  startDate: string;
  endDate: string;
}): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    await updateCampaignChannel(db, actor, input.campaignChannelId, {
      contractedQuantity: input.contractedQuantity,
      clientUnitPrice: input.clientUnitPrice,
      costBudget: input.costBudget === undefined || input.costBudget === "" ? undefined : input.costBudget,
      currency: input.currency,
      startDate: new Date(input.startDate),
      endDate: new Date(input.endDate),
    });
    revalidatePath(`/campaigns/${input.campaignId}/channels/${input.campaignChannelId}`);
    revalidatePath(`/campaigns/${input.campaignId}`);
    return null;
  });
}

export async function setChannelStatusAction(
  campaignId: string, // only for revalidatePath
  channelId: string,
  status: CampaignChannelStatus,
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    await setChannelStatus(db, actor, { channelId, status });
    revalidatePath(`/campaigns/${campaignId}/channels/${channelId}`);
    revalidatePath(`/campaigns/${campaignId}`);
    return null;
  });
}

export async function deleteChannelAction(
  campaignId: string,
  channelId: string,
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    await deleteCampaignChannel(db, actor, channelId);
    revalidatePath(`/campaigns/${campaignId}`);
    return null;
  });
}

export async function submitChannelForApprovalAction(
  campaignId: string, // only for revalidatePath
  channelId: string,
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    await submitChannelForApproval(db, actor, channelId);
    revalidatePath(`/campaigns/${campaignId}/channels/${channelId}`);
    revalidatePath(`/campaigns/${campaignId}`);
    return null;
  });
}

export async function withdrawChannelFromApprovalAction(
  campaignId: string, // only for revalidatePath
  channelId: string,
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    await withdrawChannelFromApproval(db, actor, channelId);
    revalidatePath(`/campaigns/${campaignId}/channels/${channelId}`);
    revalidatePath(`/campaigns/${campaignId}`);
    return null;
  });
}

export async function addChannelSetupStepAction(
  campaignId: string,
  channelId: string,
  stepKey: ChannelSetupStepKey,
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    await addChannelSetupStep(db, actor, channelId, stepKey);
    revalidatePath(`/campaigns/${campaignId}/channels/${channelId}`);
    return null;
  });
}

export async function removeChannelSetupStepAction(
  campaignId: string,
  channelId: string,
  stepKey: ChannelSetupStepKey,
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    await removeChannelSetupStep(db, actor, channelId, stepKey);
    revalidatePath(`/campaigns/${campaignId}/channels/${channelId}`);
    return null;
  });
}

export async function setChannelStepRequirementAction(
  campaignId: string,
  channelId: string,
  stepKey: ChannelSetupStepKey,
  requirement: ChannelSetupRequirement,
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    await setChannelStepRequirement(db, actor, channelId, stepKey, requirement);
    revalidatePath(`/campaigns/${campaignId}/channels/${channelId}`);
    return null;
  });
}

export async function uploadTargetAccountListAction(
  campaignId: string,
  channelId: string,
  input: { name: string; content: string; mapping: Record<string, string> },
): Promise<ActionResult<{ listId: string; rowsAccepted: number; rowsTotal: number }>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    const result = await importAndAttachTargetAccountList(db, actor, channelId, input);
    revalidatePath(`/campaigns/${campaignId}/channels/${channelId}`);
    return { listId: result.listId, rowsAccepted: result.rowsAccepted, rowsTotal: result.rowsTotal };
  });
}

export async function addTargetAccountEntryAction(
  campaignId: string,
  channelId: string,
  input: AddTargetAccountEntryInput,
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    await addTargetAccountEntry(db, actor, channelId, input);
    revalidatePath(`/campaigns/${campaignId}/channels/${channelId}`);
    return null;
  });
}

export async function removeTargetAccountEntryAction(
  campaignId: string,
  channelId: string,
  entryId: string,
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    await removeTargetAccountEntry(db, actor, channelId, entryId);
    revalidatePath(`/campaigns/${campaignId}/channels/${channelId}`);
    return null;
  });
}

export async function detachTargetAccountListAction(
  campaignId: string,
  channelId: string,
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    await detachTargetAccountList(db, actor, channelId);
    revalidatePath(`/campaigns/${campaignId}/channels/${channelId}`);
    return null;
  });
}

export async function uploadSuppressionListAction(
  campaignId: string,
  channelId: string,
  input: { name: string; content: string; mapping: Record<string, string> },
): Promise<ActionResult<{ listId: string; rowsAccepted: number; rowsTotal: number }>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    const result = await importAndAttachSuppressionList(db, actor, channelId, input);
    revalidatePath(`/campaigns/${campaignId}/channels/${channelId}`);
    return { listId: result.listId, rowsAccepted: result.rowsAccepted, rowsTotal: result.rowsTotal };
  });
}

export async function addSuppressionEntryAction(
  campaignId: string,
  channelId: string,
  input: AddSuppressionEntryInput,
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    await addSuppressionEntry(db, actor, channelId, input);
    revalidatePath(`/campaigns/${campaignId}/channels/${channelId}`);
    return null;
  });
}

export async function removeSuppressionEntryAction(
  campaignId: string,
  channelId: string,
  entryId: string,
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    await removeSuppressionEntry(db, actor, channelId, entryId);
    revalidatePath(`/campaigns/${campaignId}/channels/${channelId}`);
    return null;
  });
}

export async function detachSuppressionListAction(
  campaignId: string,
  channelId: string,
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    await detachSuppressionList(db, actor, channelId);
    revalidatePath(`/campaigns/${campaignId}/channels/${channelId}`);
    return null;
  });
}
