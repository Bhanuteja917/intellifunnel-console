import { ValidationError } from "@/lib/errors";

/** Currencies the platform accepts, with their ISO 4217 minor-unit exponent. */
export const CURRENCY_EXPONENTS: Readonly<Record<string, number>> = {
  INR: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  AUD: 2,
  SGD: 2,
  AED: 2,
  JPY: 0,
};

export type CurrencyCode = keyof typeof CURRENCY_EXPONENTS;

export type Money = {
  amountMinor: bigint;
  currency: string;
};

export function exponentFor(currency: string): number {
  const exponent = CURRENCY_EXPONENTS[currency];
  if (exponent === undefined) {
    throw new ValidationError(`Unsupported currency: ${currency}`);
  }
  return exponent;
}

/** Parses a decimal string into integer minor units. Never uses floating point. */
export function toMinorUnits(amount: string, currency: string): bigint {
  const exponent = exponentFor(currency);
  const trimmed = amount.trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (match === null) {
    throw new ValidationError(`Invalid amount: ${amount}`);
  }
  const [, sign = "", whole = "0", fraction = ""] = match;
  if (fraction.length > exponent) {
    throw new ValidationError(
      `${currency} has ${exponent} minor unit digits; got "${amount}"`,
    );
  }
  const padded = fraction.padEnd(exponent, "0");
  return BigInt(`${sign}${whole}${padded}`);
}

export function fromMinorUnits(amountMinor: bigint, currency: string): string {
  const exponent = exponentFor(currency);
  if (exponent === 0) return amountMinor.toString();
  const negative = amountMinor < 0n;
  const digits = (negative ? -amountMinor : amountMinor).toString().padStart(exponent + 1, "0");
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = digits.slice(digits.length - exponent);
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

export function formatMoney(money: Money): string {
  return `${money.currency} ${fromMinorUnits(money.amountMinor, money.currency)}`;
}
