export type DateRange = { from: Date; to: Date };

export function defaultDateRange(now: Date = new Date()): DateRange {
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - 30);
  return { from, to: now };
}
