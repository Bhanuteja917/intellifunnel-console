import { type PacingBucket } from "@/lib/allocations/pacing";
import { type PrismaClient } from "@prisma/client";
import { assertOrganizationAccess, type Actor } from "@/lib/auth/permissions";
import { withAudit } from "@/lib/audit/audit";
import { ValidationError, NotFoundError } from "@/lib/errors";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Number of days between two UTC-midnight Date objects (inclusive of both ends) */
function daysBetween(start: Date, end: Date): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((end.getTime() - start.getTime()) / MS_PER_DAY) + 1;
}

/** Returns a new Date set to the last day of the same calendar month as `d` (UTC). */
function endOfMonthUTC(d: Date): Date {
  // new Date(year, month+1, 0) gives the last day of `month` in local time,
  // but since our dates arrive as UTC-midnight we work in UTC throughout.
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  // day=0 of the next month rolls back to last day of current month
  return new Date(Date.UTC(year, month + 1, 0));
}

/** Returns a new Date set to the first day of the same calendar month as `d` (UTC). */
function startOfMonthUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/** Returns the Monday (UTC) of the ISO week that contains `d`. */
function startOfISOWeekUTC(d: Date): Date {
  // getUTCDay(): 0=Sun, 1=Mon … 6=Sat.  ISO week starts Monday.
  const day = d.getUTCDay(); // 0-6
  const offsetToMonday = day === 0 ? -6 : 1 - day; // negative = go back
  const ms = d.getTime() + offsetToMonday * 24 * 60 * 60 * 1000;
  return new Date(ms);
}

/** Returns the Sunday (UTC) of the ISO week that contains `d`. */
function endOfISOWeekUTC(d: Date): Date {
  const day = d.getUTCDay(); // 0=Sun, 1=Mon … 6=Sat
  const offsetToSunday = day === 0 ? 0 : 7 - day;
  const ms = d.getTime() + offsetToSunday * 24 * 60 * 60 * 1000;
  return new Date(ms);
}

/** Clamps `date` to be no later than `ceiling` (returns the earlier of the two). */
function clamp(date: Date, ceiling: Date): Date {
  return date.getTime() <= ceiling.getTime() ? date : new Date(ceiling.getTime());
}

/** Adds `days` calendar days to a UTC-midnight date. */
function addDaysUTC(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * Distribute `total` proportionally across `parts` (each a day count).
 * The last slot absorbs any rounding remainder.
 */
function distributeQuantity(total: number, parts: number[]): number[] {
  const totalDays = parts.reduce((a, b) => a + b, 0);
  const quantities: number[] = [];
  let allocated = 0;
  for (let i = 0; i < parts.length - 1; i++) {
    const q = Math.round((total * (parts[i] ?? 0)) / totalDays);
    quantities.push(q);
    allocated += q;
  }
  // Last bucket absorbs rounding remainder
  quantities.push(total - allocated);
  return quantities;
}

// ---------------------------------------------------------------------------
// generateBuckets
// ---------------------------------------------------------------------------

export function generateBuckets(
  channel: { startDate: Date; endDate: Date; contractedQuantity: number },
  granularity: "week" | "month",
): PacingBucket[] {
  const { startDate, endDate, contractedQuantity } = channel;

  if (granularity === "month") {
    return generateMonthBuckets(startDate, endDate, contractedQuantity);
  } else {
    return generateWeekBuckets(startDate, endDate, contractedQuantity);
  }
}

function generateMonthBuckets(
  startDate: Date,
  endDate: Date,
  contractedQuantity: number,
): PacingBucket[] {
  const ranges: Array<{ periodStart: Date; periodEnd: Date }> = [];

  // Same calendar month → single bucket
  if (
    startDate.getUTCFullYear() === endDate.getUTCFullYear() &&
    startDate.getUTCMonth() === endDate.getUTCMonth()
  ) {
    ranges.push({ periodStart: startDate, periodEnd: endDate });
  } else {
    // First bucket: startDate → end of that month (clamped)
    ranges.push({
      periodStart: startDate,
      periodEnd: clamp(endOfMonthUTC(startDate), endDate),
    });

    // Middle buckets: full calendar months
    let cursor = startOfMonthUTC(addDaysUTC(endOfMonthUTC(startDate), 1));
    while (
      cursor.getUTCFullYear() < endDate.getUTCFullYear() ||
      (cursor.getUTCFullYear() === endDate.getUTCFullYear() &&
        cursor.getUTCMonth() < endDate.getUTCMonth())
    ) {
      const bucketEnd = endOfMonthUTC(cursor);
      ranges.push({ periodStart: cursor, periodEnd: bucketEnd });
      cursor = addDaysUTC(bucketEnd, 1);
    }

    // Last bucket: 1st of final month → endDate
    ranges.push({
      periodStart: startOfMonthUTC(endDate),
      periodEnd: endDate,
    });
  }

  // Distribute quantities
  const parts = ranges.map((r) => daysBetween(r.periodStart, r.periodEnd));
  const quantities = distributeQuantity(contractedQuantity, parts);

  return ranges.map((r, i) => ({
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    targetQuantity: quantities[i] ?? 0,
  }));
}

function generateWeekBuckets(
  startDate: Date,
  endDate: Date,
  contractedQuantity: number,
): PacingBucket[] {
  const ranges: Array<{ periodStart: Date; periodEnd: Date }> = [];

  const startSunday = endOfISOWeekUTC(startDate);
  const endMonday = startOfISOWeekUTC(endDate);

  // Same ISO week → single bucket
  if (startDate.getTime() >= endMonday.getTime()) {
    ranges.push({ periodStart: startDate, periodEnd: endDate });
  } else {
    // First bucket: startDate → Sunday of that week (clamped)
    ranges.push({
      periodStart: startDate,
      periodEnd: clamp(startSunday, endDate),
    });

    // Middle buckets: full Mon–Sun ISO weeks
    let cursor = addDaysUTC(startSunday, 1); // Monday after first Sunday
    while (cursor.getTime() < endMonday.getTime()) {
      const bucketEnd = endOfISOWeekUTC(cursor); // Sunday of this week
      ranges.push({ periodStart: cursor, periodEnd: bucketEnd });
      cursor = addDaysUTC(bucketEnd, 1); // next Monday
    }

    // Last bucket: Monday of final ISO week → endDate
    ranges.push({
      periodStart: endMonday,
      periodEnd: endDate,
    });
  }

  // Distribute quantities
  const parts = ranges.map((r) => daysBetween(r.periodStart, r.periodEnd));
  const quantities = distributeQuantity(contractedQuantity, parts);

  return ranges.map((r, i) => ({
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    targetQuantity: quantities[i] ?? 0,
  }));
}

// ---------------------------------------------------------------------------
// validateBuckets
// ---------------------------------------------------------------------------

export function validateBuckets(
  buckets: PacingBucket[],
  contractedQuantity: number,
  startDate: Date,
  endDate: Date,
): string | null {
  // 1. Non-empty
  if (buckets.length === 0) {
    return "Buckets must not be empty";
  }

  const first = buckets[0]!;
  const last = buckets[buckets.length - 1]!;

  // 2. First bucket periodStart === startDate
  if (first.periodStart.toISOString().slice(0, 10) !== startDate.toISOString().slice(0, 10)) {
    return `First bucket periodStart (${first.periodStart.toISOString().slice(0, 10)}) does not match channel startDate (${startDate.toISOString().slice(0, 10)})`;
  }

  // 3. Last bucket periodEnd === endDate
  if (last.periodEnd.toISOString().slice(0, 10) !== endDate.toISOString().slice(0, 10)) {
    return `Last bucket periodEnd (${last.periodEnd.toISOString().slice(0, 10)}) does not match channel endDate (${endDate.toISOString().slice(0, 10)})`;
  }

  // 4. Non-overlapping: bucket[i].periodEnd + 1 day = bucket[i+1].periodStart
  for (let i = 0; i < buckets.length - 1; i++) {
    const current = buckets[i]!;
    const next = buckets[i + 1]!;
    const expectedNextStart = addDaysUTC(current.periodEnd, 1).toISOString().slice(0, 10);
    const actualNextStart = next.periodStart.toISOString().slice(0, 10);
    if (expectedNextStart !== actualNextStart) {
      return `Buckets are not contiguous: bucket ${i} ends ${current.periodEnd.toISOString().slice(0, 10)} but bucket ${i + 1} starts ${actualNextStart}`;
    }
  }

  // 5. Sum of targetQuantity === contractedQuantity
  const total = buckets.reduce((sum, b) => sum + b.targetQuantity, 0);
  if (total !== contractedQuantity) {
    return `Sum of targetQuantity (${total}) does not equal contractedQuantity (${contractedQuantity})`;
  }

  // 6. Per-bucket: integer check, start <= end, non-negative
  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i]!;
    if (!Number.isInteger(b.targetQuantity)) return "targetQuantity must be an integer";
    if (b.periodStart.getTime() > b.periodEnd.getTime()) return "periodStart must not be after periodEnd";
    if (b.targetQuantity < 0) {
      return `Bucket ${i} has negative targetQuantity (${b.targetQuantity})`;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// saveSchedule
// ---------------------------------------------------------------------------

export async function saveSchedule(
  db: PrismaClient,
  actor: Actor,
  channelId: string,
  buckets: PacingBucket[],
): Promise<void> {
  const channel = await db.campaignChannel.findUnique({
    where: { id: channelId },
    include: {
      campaign: { select: { status: true, clientOrganizationId: true, deletedAt: true } },
    },
  });
  if (!channel || channel.campaign.deletedAt !== null) throw new NotFoundError("Channel not found");
  assertOrganizationAccess(actor, channel.campaign.clientOrganizationId);
  if (channel.campaign.status === "completed" || channel.campaign.status === "cancelled") {
    throw new ValidationError(`Campaign is ${channel.campaign.status}; pacing schedules cannot be modified`);
  }
  if (channel.status === "completed") {
    throw new ValidationError(`Channel is completed; its pacing schedule cannot be modified`);
  }
  const { contractedQuantity, startDate, endDate } = channel;

  const validationError = validateBuckets(buckets, contractedQuantity, startDate, endDate);
  if (validationError) throw new ValidationError(validationError);

  await withAudit(
    db,
    actor,
    {
      entityType: "ChannelPacingBucket",
      entityId: channelId,
      action: "saveSchedule",
      before: { bucketCount: await db.channelPacingBucket.count({ where: { campaignChannelId: channelId } }) },
      after: { bucketCount: buckets.length },
    },
    async (tx) => {
      await tx.channelPacingBucket.deleteMany({ where: { campaignChannelId: channelId } });
      await tx.channelPacingBucket.createMany({
        data: buckets.map((b) => ({
          campaignChannelId: channelId,
          periodStart: b.periodStart,
          periodEnd: b.periodEnd,
          targetQuantity: b.targetQuantity,
          createdById: actor.userId,
          updatedById: actor.userId,
        })),
      });
    },
  );
}

// ---------------------------------------------------------------------------
// deleteSchedule
// ---------------------------------------------------------------------------

export async function deleteSchedule(
  db: PrismaClient,
  actor: Actor,
  channelId: string,
): Promise<void> {
  const channel = await db.campaignChannel.findUnique({
    where: { id: channelId },
    include: {
      campaign: { select: { status: true, clientOrganizationId: true, deletedAt: true } },
    },
  });
  if (!channel || channel.campaign.deletedAt !== null) throw new NotFoundError("Channel not found");
  assertOrganizationAccess(actor, channel.campaign.clientOrganizationId);
  if (channel.campaign.status === "completed" || channel.campaign.status === "cancelled") {
    throw new ValidationError(`Campaign is ${channel.campaign.status}; pacing schedules cannot be modified`);
  }
  if (channel.status === "completed") {
    throw new ValidationError(`Channel is completed; its pacing schedule cannot be modified`);
  }

  await withAudit(
    db,
    actor,
    {
      entityType: "ChannelPacingBucket",
      entityId: channelId,
      action: "deleteSchedule",
    },
    async (tx) => {
      await tx.channelPacingBucket.deleteMany({ where: { campaignChannelId: channelId } });
    },
  );
}
