import { parse } from "tldts";

export function normalizeDomain(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  const parsed = parse(trimmed, { allowPrivateDomains: false });
  if (parsed.isIp) return null;
  const domain = parsed.domain;
  if (domain === null || domain === "") return null;
  return domain.toLowerCase().replace(/\.$/, "");
}
