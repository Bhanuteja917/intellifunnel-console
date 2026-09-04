import type { Prisma, PrismaClient } from "@prisma/client";
import type { ChannelTypeDefinition } from "@/lib/channel-types/versions";
import { getSetting, type WeekDay } from "@/lib/settings/settings";
import { operatingDayStart } from "@/lib/time/operating-day";

type Db = PrismaClient | Prisma.TransactionClient;

const MINUTES_PER_DAY = 1440;
const DAY_MS = 24 * 60 * 60 * 1000;

// `Date.prototype.getUTCDay()` index (0 = Sunday .. 6 = Saturday) mapped to
// the `WeekDay` codes used by the `workingDays` platform setting.
const WEEKDAY_BY_UTC_DAY_INDEX: WeekDay[] = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

export type VerificationSlaResult = {
  elapsedMinutes: number;
  elapsedBusinessMinutes: number;
  allowedBusinessDays: number;
  breached: boolean;
  percentElapsed: number;
};

/**
 * The SLA allowance comes from the version a campaign channel is bound to, not
 * the live `ChannelType` row — `publishChannelTypeVersion` freezes it into
 * `definitionJson` precisely so a later edit cannot reach bound campaigns.
 * A snapshot predating that field (`undefined`, as opposed to a real `null`
 * meaning "use the platform default") falls back to the live row.
 */
export async function resolveAllowedBusinessDays(
  db: Db,
  channelTypeVersion: {
    definitionJson: unknown;
    channelType: { verificationSlaBusinessDays: number | null };
  },
): Promise<number> {
  const snapshot = (channelTypeVersion.definitionJson as Partial<ChannelTypeDefinition> | null)
    ?.verificationSlaBusinessDays;
  const allowed = snapshot === undefined ? channelTypeVersion.channelType.verificationSlaBusinessDays : snapshot;
  return allowed ?? (await getSetting(db, "defaultVerificationSlaBusinessDays"));
}

/**
 * FR-VF-2b/2c: business-day SLA computation for lead verification.
 *
 * Day boundaries are computed in the platform's `operatingTimezone` setting
 * via `operatingDayStart`, consistent with the rest of the codebase's
 * operating-day convention — not server-local time, not naive UTC.
 *
 * Business-day counting is day-level granularity only, per `PlatformSetting`'s
 * own `workingHours` note that hour-level SLA precision is an opt-in setting
 * and day-level is the v1 default. `elapsedBusinessMinutes` is therefore
 * always a whole multiple of 1440 — no partial-day logic.
 *
 * Known v1 simplification (already an acknowledged open risk in the spec —
 * SRS §11 risk #1 — not introduced by this function): `Holiday.date` is
 * unique per `[country, date]`, but a lead has no single "the" country to
 * scope the holiday calendar by. For v1 every active `Holiday` row is
 * treated as one shared calendar and the `country` column is ignored when
 * filtering, until per-country calendars are built.
 */
export async function computeVerificationSla(
  db: Db,
  params: { createdAt: Date; asOf: Date; allowedBusinessDays: number },
): Promise<VerificationSlaResult> {
  const { createdAt, asOf, allowedBusinessDays } = params;

  const [operatingTimezone, workingDays] = await Promise.all([
    getSetting(db, "operatingTimezone"),
    getSetting(db, "workingDays"),
  ]);

  const startDay = operatingDayStart(createdAt, operatingTimezone);
  const endDay = operatingDayStart(asOf, operatingTimezone);

  // See the simplification note above: country is deliberately not part of
  // this filter.
  const holidays = await db.holiday.findMany({
    where: { isActive: true, date: { gte: startDay, lte: endDay } },
    select: { date: true },
  });
  const holidayDayMs = new Set(holidays.map((holiday) => holiday.date.getTime()));
  const workingDaySet = new Set<WeekDay>(workingDays);

  let elapsedBusinessDays = 0;
  for (let dayMs = startDay.getTime(); dayMs <= endDay.getTime(); dayMs += DAY_MS) {
    const weekday = WEEKDAY_BY_UTC_DAY_INDEX[new Date(dayMs).getUTCDay()]!;
    if (workingDaySet.has(weekday) && !holidayDayMs.has(dayMs)) {
      elapsedBusinessDays += 1;
    }
  }

  const elapsedMinutes = Math.floor((asOf.getTime() - createdAt.getTime()) / 60_000);
  const elapsedBusinessMinutes = elapsedBusinessDays * MINUTES_PER_DAY;
  const allowedBusinessMinutes = allowedBusinessDays * MINUTES_PER_DAY;

  return {
    elapsedMinutes,
    elapsedBusinessMinutes,
    allowedBusinessDays,
    breached: elapsedBusinessMinutes > allowedBusinessMinutes,
    percentElapsed: elapsedBusinessMinutes / allowedBusinessMinutes,
  };
}
