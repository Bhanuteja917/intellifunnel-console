import { addMonths } from "date-fns";

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
