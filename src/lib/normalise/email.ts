import { ValidationError } from "@/lib/errors";
import { normalizeDomain } from "@/lib/normalise/domain";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function normalizeEmail(input: string): string {
  const normalised = input.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(normalised)) {
    throw new ValidationError(`Invalid email address: ${input}`);
  }
  return normalised;
}

export function emailDomain(input: string): string | null {
  const normalised = normalizeEmail(input);
  const [, host] = normalised.split("@");
  return host === undefined ? null : normalizeDomain(host);
}
