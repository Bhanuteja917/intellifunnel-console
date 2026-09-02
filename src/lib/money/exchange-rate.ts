import { Prisma, type PrismaClient } from "@prisma/client";
import { ApplicationError } from "@/lib/errors";
import { exponentFor, type Money } from "@/lib/money/currency";

export class MissingExchangeRateError extends ApplicationError {
  constructor(from: string, to: string, onDate: Date) {
    super(
      `No exchange rate for ${from}->${to} effective on or before ${onDate.toISOString().slice(0, 10)}`,
      "MISSING_EXCHANGE_RATE",
    );
  }
}

/** Any Prisma client or interactive transaction client. */
export type Db = PrismaClient | Prisma.TransactionClient;

/**
 * CUR-7: the most recent entry with effectiveDate on or before the transaction
 * date. Rates are never interpolated.
 */
export async function getRateOn(
  client: Db,
  fromCurrency: string,
  toCurrency: string,
  onDate: Date,
): Promise<{ id: string; rate: Prisma.Decimal }> {
  const row = await client.exchangeRate.findFirst({
    where: { fromCurrency, toCurrency, effectiveDate: { lte: onDate } },
    orderBy: { effectiveDate: "desc" },
    select: { id: true, rate: true },
  });
  // CUR-5: a missing rate is a hard error, never a silent fallback to 1.0.
  if (row === null) throw new MissingExchangeRateError(fromCurrency, toCurrency, onDate);
  return row;
}

/**
 * CUR-3: converts at the transaction date and returns the rate id so the
 * caller can persist it alongside the converted amount.
 */
export async function convertToReporting(
  client: Db,
  money: Money,
  onDate: Date,
  reportingCurrency: string,
): Promise<{ amountMinor: bigint; currency: string; exchangeRateId: string | null }> {
  if (money.currency === reportingCurrency) {
    return { amountMinor: money.amountMinor, currency: reportingCurrency, exchangeRateId: null };
  }

  const { id, rate } = await getRateOn(client, money.currency, reportingCurrency, onDate);
  const fromExponent = exponentFor(money.currency);
  const toExponent = exponentFor(reportingCurrency);

  const converted = new Prisma.Decimal(money.amountMinor.toString())
    .div(new Prisma.Decimal(10).pow(fromExponent))
    .mul(rate)
    .mul(new Prisma.Decimal(10).pow(toExponent))
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);

  return {
    amountMinor: BigInt(converted.toFixed(0)),
    currency: reportingCurrency,
    exchangeRateId: id,
  };
}
