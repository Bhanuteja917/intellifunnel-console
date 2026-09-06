const WEEKDAY_NUMBERS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

type ZonedCronFields = { minute: number; hour: number; day: number; month: number; weekday: number };

function zonedCronFields(instant: Date, timeZone: string): ZonedCronFields {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    minute: "numeric",
    hour: "numeric",
    hour12: false,
    day: "numeric",
    month: "numeric",
    weekday: "short",
  }).formatToParts(instant);

  const value = (type: Intl.DateTimeFormatPartTypes): string => {
    const part = parts.find((p) => p.type === type);
    if (part === undefined) throw new Error(`Cannot read ${type} for timezone ${timeZone}`);
    return part.value;
  };

  return {
    minute: Number(value("minute")),
    hour: Number(value("hour")) % 24, // some locales render midnight as "24" under hour12:false
    day: Number(value("day")),
    month: Number(value("month")),
    weekday: WEEKDAY_NUMBERS[value("weekday")] ?? 0,
  };
}

function fieldMatches(field: string, value: number): boolean {
  if (field === "*") return true;
  return field.split(",").map(Number).includes(value);
}

/**
 * Standard 5-field cron (minute hour day-of-month month day-of-week), matched
 * against one instant in the given zone. Only "*" and comma-lists are
 * supported — no ranges or steps, which none of this epic's delivery
 * schedules need.
 */
export function cronMatchesInstant(cronExpression: string, instant: Date, timeZone: string): boolean {
  const fields = cronExpression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Cron expression must have exactly 5 fields: "${cronExpression}"`);
  }
  const [minuteField, hourField, dayField, monthField, weekdayField] = fields as [string, string, string, string, string];
  const zoned = zonedCronFields(instant, timeZone);
  return (
    fieldMatches(minuteField, zoned.minute) &&
    fieldMatches(hourField, zoned.hour) &&
    fieldMatches(dayField, zoned.day) &&
    fieldMatches(monthField, zoned.month) &&
    fieldMatches(weekdayField, zoned.weekday)
  );
}

/**
 * A CSV DeliveryConfig is "due" once per matching cron minute, whether or
 * not it has ever run before — a config with no successful run yet is due
 * exactly when `now` first lands on a matching minute, same as any other
 * tick. The one-minute guard after a run prevents re-firing on a second
 * tick that lands in the same matching minute (the worker's default tick
 * interval is 60s, close enough to cron's own minute resolution that this
 * guard matters).
 */
export function isCsvRunDue(cronExpression: string, lastRunAt: Date | null, now: Date, timeZone: string): boolean {
  if (lastRunAt !== null && now.getTime() - lastRunAt.getTime() < 60_000) return false;
  return cronMatchesInstant(cronExpression, now, timeZone);
}
