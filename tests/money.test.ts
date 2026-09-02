import { beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { resetDb, testDb } from "./helpers/db";
import { formatMoney, fromMinorUnits, toMinorUnits } from "@/lib/money/currency";
import {
  MissingExchangeRateError,
  convertToReporting,
  getRateOn,
} from "@/lib/money/exchange-rate";
import { ValidationError } from "@/lib/errors";

describe("minor units", () => {
  it.each([
    ["10.50", "USD", 1050n],
    ["10", "USD", 1000n],
    ["1234.05", "INR", 123405n],
    ["1000", "JPY", 1000n],
  ])("converts %s %s to %s minor units", (amount, currency, expected) => {
    expect(toMinorUnits(amount, currency)).toBe(expected);
  });

  it("round-trips", () => {
    expect(fromMinorUnits(toMinorUnits("99.99", "USD"), "USD")).toBe("99.99");
  });

  it("rejects more decimal places than the currency has", () => {
    expect(() => toMinorUnits("10.005", "USD")).toThrow(ValidationError);
  });

  it("rejects an unknown currency", () => {
    expect(() => toMinorUnits("10.00", "XYZ")).toThrow(ValidationError);
  });

  it("formats with the currency code", () => {
    expect(formatMoney({ amountMinor: 123405n, currency: "INR" })).toBe("INR 1234.05");
  });
});

describe("exchange rates", () => {
  beforeEach(resetDb);

  it("returns the most recent rate on or before the transaction date", async () => {
    const db = testDb();
    await db.exchangeRate.createMany({
      data: [
        { fromCurrency: "USD", toCurrency: "INR", rate: new Prisma.Decimal("83.0"), effectiveDate: new Date("2026-01-01") },
        { fromCurrency: "USD", toCurrency: "INR", rate: new Prisma.Decimal("85.0"), effectiveDate: new Date("2026-03-01") },
      ],
    });

    const rate = await getRateOn(db, "USD", "INR", new Date("2026-02-15"));
    expect(rate.rate.toString()).toBe("83");
  });

  it("throws rather than falling back to 1.0 when no rate exists", async () => {
    await expect(
      getRateOn(testDb(), "EUR", "INR", new Date("2026-02-15")),
    ).rejects.toBeInstanceOf(MissingExchangeRateError);
  });

  it("never interpolates between rates", async () => {
    const db = testDb();
    await db.exchangeRate.createMany({
      data: [
        { fromCurrency: "USD", toCurrency: "INR", rate: new Prisma.Decimal("80.0"), effectiveDate: new Date("2026-01-01") },
        { fromCurrency: "USD", toCurrency: "INR", rate: new Prisma.Decimal("90.0"), effectiveDate: new Date("2026-02-01") },
      ],
    });
    const rate = await getRateOn(db, "USD", "INR", new Date("2026-01-20"));
    expect(rate.rate.toString()).toBe("80");
  });

  it("converts and persists the rate used", async () => {
    const db = testDb();
    const created = await db.exchangeRate.create({
      data: { fromCurrency: "USD", toCurrency: "INR", rate: new Prisma.Decimal("83.5"), effectiveDate: new Date("2026-01-01") },
    });

    const result = await convertToReporting(
      db,
      { amountMinor: 10_000n, currency: "USD" },
      new Date("2026-02-01"),
      "INR",
    );

    // 100.00 USD * 83.5 = 8350.00 INR = 835000 paise
    expect(result.amountMinor).toBe(835_000n);
    expect(result.currency).toBe("INR");
    expect(result.exchangeRateId).toBe(created.id);
  });

  it("is an identity conversion when the currencies match", async () => {
    const result = await convertToReporting(
      testDb(),
      { amountMinor: 500n, currency: "INR" },
      new Date("2026-02-01"),
      "INR",
    );
    expect(result.amountMinor).toBe(500n);
    expect(result.exchangeRateId).toBeNull();
  });
});
