export type DateRange = { from: Date; to: Date };

export function defaultDateRange(now: Date = new Date()): DateRange {
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - 30);
  return { from, to: now };
}

/** A bare `YYYY-MM-DD` as written by `<DateRangePicker>` / `<input type="date">`. */
const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parses the `?from=&to=` query params every report page reads.
 *
 * Lives here, in one place, because the two ends are NOT symmetric and every
 * page must get that asymmetry identically. `Date.parse("2026-09-06")` is UTC
 * *midnight*, which is the right lower bound but the wrong upper bound: used
 * as `lte` against a real `DateTime` column (`Lead.createdAt`,
 * `DeliveryRun.createdAt`) it excludes all but the first instant of the
 * selected end day, while against a `@db.Date` column (`EngagementEvent.date`)
 * midnight *does* include that day. Three pages each rolling their own parser
 * produced exactly that split: "Leads submitted" dropped today's leads while
 * "Impressions" kept them, on the same page, under the same picker. So a bare
 * `to` date is widened to the end of that day; `from` stays start-of-day.
 */
export function parseDateRangeParams(
  params: { from?: string; to?: string },
  fallback: DateRange,
): DateRange {
  return { from: parseFrom(params.from, fallback.from), to: parseTo(params.to, fallback.to) };
}

function parseFrom(value: string | undefined, fallback: Date): Date {
  if (value === undefined) return fallback;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? fallback : new Date(ms);
}

function parseTo(value: string | undefined, fallback: Date): Date {
  if (value === undefined) return fallback;
  if (BARE_DATE.test(value)) {
    const ms = Date.parse(`${value}T23:59:59.999Z`);
    return Number.isNaN(ms) ? fallback : new Date(ms);
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? fallback : new Date(ms);
}
