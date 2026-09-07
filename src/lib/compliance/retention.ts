import { addMonths } from "date-fns";
import type { Prisma, PrismaClient } from "@prisma/client";
import { getSetting } from "@/lib/settings/settings";

export type LeadRetentionInput = {
  acceptedAt: Date | null;
  retentionMonths: number;
};

/**
 * The contact's overall deadline is the latest across all its leads — the
 * most conservative client's retention window governs, since anonymizing
 * early would destroy data a different client's still-open window still
 * protects. A lead never accepted has no clock (retention runs from
 * acceptance per the PRD), so any such lead makes the whole contact
 * ineligible for anonymization for now.
 */
export function computeRetentionDeadline(leads: readonly LeadRetentionInput[]): Date | null {
  if (leads.length === 0) return null;
  let latest: Date | null = null;
  for (const lead of leads) {
    if (lead.acceptedAt === null) return null;
    const deadline = addMonths(lead.acceptedAt, lead.retentionMonths);
    if (latest === null || deadline > latest) latest = deadline;
  }
  return latest;
}

export type ContactPiiPatch = {
  email: string;
  emailNormalized: string;
  firstName: null;
  lastName: null;
  phone: null;
  jobTitle: null;
  seniority: null;
  jobFunction: null;
  country: null;
  linkedinUrl: null;
  anonymisedAt: Date;
};

/** Shared by the batch job and the manual erasure action (Task 7) — never diverge the two scrub paths. */
export function buildContactPiiPatch(contactId: string, now: Date): ContactPiiPatch {
  const placeholder = `anonymized-${contactId}@erased.invalid`;
  return {
    email: placeholder,
    emailNormalized: placeholder,
    firstName: null,
    lastName: null,
    phone: null,
    jobTitle: null,
    seniority: null,
    jobFunction: null,
    country: null,
    linkedinUrl: null,
    anonymisedAt: now,
  };
}

export async function anonymizeExpiredContacts(db: PrismaClient, now: Date): Promise<number> {
  const platformDefaultMonths = await getSetting(db, "personalDataRetentionMonths");

  const contacts = await db.contact.findMany({
    where: { anonymisedAt: null },
    select: {
      id: true,
      leads: {
        select: {
          acceptedAt: true,
          campaignChannel: {
            select: {
              campaign: { select: { clientOrganization: { select: { personalDataRetentionMonths: true } } } },
            },
          },
        },
      },
    },
  });

  let anonymizedCount = 0;
  for (const contact of contacts) {
    const deadline = computeRetentionDeadline(
      contact.leads.map((lead) => ({
        acceptedAt: lead.acceptedAt,
        retentionMonths: lead.campaignChannel.campaign.clientOrganization.personalDataRetentionMonths ?? platformDefaultMonths,
      })),
    );
    if (deadline === null || now < deadline) continue;

    await db.contact.update({
      where: { id: contact.id },
      data: buildContactPiiPatch(contact.id, now) as unknown as Prisma.ContactUpdateInput,
    });
    anonymizedCount += 1;
  }
  return anonymizedCount;
}
