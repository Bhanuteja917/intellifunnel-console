export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  const hasLeadingPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/[^\d]/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return hasLeadingPlus ? `+${digits}` : digits;
}
