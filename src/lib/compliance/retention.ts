import { addMonths } from "date-fns";
import type { Prisma, PrismaClient } from "@prisma/client";
import { getSetting } from "@/lib/settings/settings";
import { assertPermission, type Actor } from "@/lib/auth/permissions";
import { withAudit } from "@/lib/audit/audit";
import { NotFoundError } from "@/lib/errors";

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

const PII_FIELD_KEYS = [
  "email",
  "firstName",
  "lastName",
  "jobTitle",
  "seniority",
  "jobFunction",
  "phone",
  "country",
  "linkedinUrl",
] as const;

/**
 * Redacts the same PII fields `buildContactPiiPatch` scrubs on `Contact`, but
 * inside every one of that contact's `Lead.fieldValuesJson` blobs. Campaigns
 * name their CSV columns freely (`LeadFieldSpec.fieldKey`), so this matches
 * case-insensitively against each Lead's own campaign's field specs — the
 * same convention `src/lib/leads/intake.ts`'s `canonicalKeyMap` already uses
 * — rather than assuming a fixed key casing across every campaign.
 *
 * Deliberately out of scope: `LeadSubmissionError.rawValue` (raw CSV values
 * kept for rows that failed validation and never became a Lead) is not
 * touched here — that would require fragile raw-string matching across an
 * unrelated table with no foreign key back to a contact, and was flagged as
 * a separate, deferred piece of work during the final review, not missed.
 */
async function redactLeadFieldValues(tx: Prisma.TransactionClient, contactId: string): Promise<void> {
  const leads = await tx.lead.findMany({
    where: { contactId },
    select: {
      id: true,
      fieldValuesJson: true,
      campaignChannelId: true,
    },
  });
  if (leads.length === 0) return;

  const channelIds = [...new Set(leads.map((lead) => lead.campaignChannelId))];
  const specs = await tx.leadFieldSpec.findMany({
    where: { campaignChannelId: { in: channelIds } },
    select: { campaignChannelId: true, fieldKey: true },
  });
  const canonicalKeysByChannel = new Map<string, Map<string, string>>();
  for (const spec of specs) {
    const map = canonicalKeysByChannel.get(spec.campaignChannelId) ?? new Map<string, string>();
    map.set(spec.fieldKey.toLowerCase(), spec.fieldKey);
    canonicalKeysByChannel.set(spec.campaignChannelId, map);
  }

  for (const lead of leads) {
    const canonicalMap = canonicalKeysByChannel.get(lead.campaignChannelId);
    if (canonicalMap === undefined) continue;

    const values = { ...(lead.fieldValuesJson as Record<string, unknown>) };
    let changed = false;
    for (const piiKey of PII_FIELD_KEYS) {
      const actualKey = canonicalMap.get(piiKey.toLowerCase());
      if (actualKey !== undefined && actualKey in values) {
        values[actualKey] = null;
        changed = true;
      }
    }
    if (changed) {
      await tx.lead.update({ where: { id: lead.id }, data: { fieldValuesJson: values as Prisma.InputJsonValue } });
    }
  }
}

export async function anonymizeExpiredContacts(db: PrismaClient, now: Date): Promise<number> {
  const platformDefaultMonths = getSetting("personalDataRetentionMonths");

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

    // Plan Global Constraint: every mutation that touches PII goes through
    // `withAudit`. This is the automated, worker-driven path, so there is no
    // actor — the same reason `applyTransition` in the campaign state machine
    // takes `Actor | null`. Contact scrub + Lead redaction + audit row all
    // commit together or not at all.
    await withAudit(
      db,
      null,
      {
        entityType: "Contact",
        entityId: contact.id,
        action: "anonymize",
        after: { anonymisedAt: now.toISOString() },
      },
      async (tx) => {
        await tx.contact.update({
          where: { id: contact.id },
          data: buildContactPiiPatch(contact.id, now),
        });
        await redactLeadFieldValues(tx, contact.id);
      },
    );
    anonymizedCount += 1;
  }
  return anonymizedCount;
}

export async function eraseContactNow(db: PrismaClient, actor: Actor, contactId: string): Promise<void> {
  assertPermission(actor, "compliance:write");

  const now = new Date();

  // The audit entry deliberately carries NO `before` snapshot: serialising the
  // contact's real name/email into `AuditLog.beforeJson` would leave a
  // durable, unscrubbed copy of exactly the PII this call just erased, in a
  // table this codebase never deletes from. `entityId` already says which
  // contact this was, which is all the audit trail needs.
  await withAudit(
    db,
    actor,
    {
      entityType: "Contact",
      entityId: contactId,
      action: "anonymize",
      after: { anonymisedAt: now.toISOString() },
    },
    async (tx) => {
      const existing = await tx.contact.findUnique({ where: { id: contactId }, select: { id: true } });
      if (existing === null) throw new NotFoundError(`Contact not found: ${contactId}`);
      await tx.contact.update({
        where: { id: contactId },
        data: buildContactPiiPatch(contactId, now),
      });
      await redactLeadFieldValues(tx, contactId);
    },
  );
}
