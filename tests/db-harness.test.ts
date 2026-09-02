import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";

describe("test database harness", () => {
  beforeEach(resetDb);

  it("applies migrations and round-trips a row", async () => {
    const db = testDb();
    await db.platformSetting.create({
      data: { key: "reportingCurrency", valueJson: "INR" },
    });
    const found = await db.platformSetting.findUnique({
      where: { key: "reportingCurrency" },
    });
    expect(found?.valueJson).toBe("INR");
  });

  it("truncates between tests", async () => {
    expect(await testDb().platformSetting.count()).toBe(0);
  });
});
