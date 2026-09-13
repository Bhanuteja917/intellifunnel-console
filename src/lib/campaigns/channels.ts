import type { CampaignChannel, CampaignChannelStatus, PrismaClient } from "@prisma/client";
import { NotFoundError, ValidationError } from "@/lib/errors";
import {
  assertOrganizationAccess,
  assertPermission,
  type Actor,
} from "@/lib/auth/permissions";
import { writeAudit } from "@/lib/audit/audit";

async function loadAccessibleChannel(
  db: PrismaClient,
  actor: Actor,
  channelId: string,
): Promise<CampaignChannel & { campaign: { status: string; clientOrganizationId: string } }> {
  const channel = await db.campaignChannel.findUnique({
    where: { id: channelId },
    include: { campaign: { select: { status: true, clientOrganizationId: true } } },
  });
  if (channel === null) throw new NotFoundError("Channel not found");
  assertOrganizationAccess(actor, channel.campaign.clientOrganizationId);
  return channel;
}

export async function setChannelStatus(
  db: PrismaClient,
  actor: Actor,
  input: { channelId: string; status: CampaignChannelStatus },
): Promise<CampaignChannel> {
  assertPermission(actor, "campaign:write");

  if (input.status !== "live" && input.status !== "paused") {
    throw new ValidationError(
      `Channel status ${input.status} is set by the campaign lifecycle, not this control`,
    );
  }

  const channel = await loadAccessibleChannel(db, actor, input.channelId);

  if (input.status === "paused" && channel.status !== "live") {
    throw new ValidationError(`Channel is ${channel.status}; only a live channel can be paused`);
  }

  if (input.status === "live" && channel.status === "draft") {
    if (channel.campaign.status !== "scheduled" && channel.campaign.status !== "live") {
      throw new ValidationError(
        `Campaign is ${channel.campaign.status}; channels activate once the campaign is scheduled or live`,
      );
    }
  }

  const updated = await db.campaignChannel.update({
    where: { id: input.channelId },
    data: { status: input.status, updatedById: actor.userId },
  });

  await writeAudit(db, actor, {
    entityType: "CampaignChannel",
    entityId: input.channelId,
    action: `setStatus:${input.status}`,
    before: { status: channel.status },
    after: { status: input.status },
  });

  return updated;
}
