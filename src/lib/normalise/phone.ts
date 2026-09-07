export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  const hasLeadingPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/[^\d]/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  // For 10-digit numbers without a country code, assume +1 (US/Canada)
  if (!hasLeadingPlus && digits.length === 10) return `+1${digits}`;
  return hasLeadingPlus ? `+${digits}` : digits;
}
