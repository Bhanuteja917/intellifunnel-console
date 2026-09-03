/**
 * Campaign flight dates are `@db.Date` columns: calendar dates with no time
 * and no zone, which Prisma hands back as a Date at UTC midnight. The calendar
 * they are written against is the platform's operating timezone
 * (`operatingTimezone`, `Asia/Kolkata` at launch), not UTC — so comparing them
 * against `new Date()` asks the wrong question and moves every day boundary by
 * the zone's offset.
 *
 * `operatingDayStart` closes that gap by mapping an instant to the calendar day
 * it falls on in a given zone, expressed in the same UTC-midnight form the date
 * columns use. Both sides of the comparison are then the same kind of thing:
 *
 *   startDate <= operatingDayStart(now, tz)   the flight has started
 *   endDate   <  operatingDayStart(now, tz)   the flight's last day has passed
 */
export function operatingDayStart(instant: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);

  const value = (type: Intl.DateTimeFormatPartTypes): string => {
    const part = parts.find((p) => p.type === type);
    if (part === undefined) {
      throw new Error(`Cannot read ${type} for timezone ${timeZone}`);
    }
    return part.value;
  };

  return new Date(`${value("year")}-${value("month")}-${value("day")}T00:00:00.000Z`);
}
