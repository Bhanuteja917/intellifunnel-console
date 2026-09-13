export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  const hasLeadingPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/[^\d]/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  // For 10-digit numbers without a country code, assume +91 (India) — this
  // platform's own primary market (see SETTING_DEFAULTS.reportingCurrency /
  // operatingTimezone). Full per-organization country-code configurability
  // is out of scope here; this is a corrected default, not a general solution.
  if (!hasLeadingPlus && digits.length === 10) return `+91${digits}`;
  return hasLeadingPlus ? `+${digits}` : digits;
}
