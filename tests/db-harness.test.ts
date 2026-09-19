import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";

describe("test database harness", () => {
  beforeEach(resetDb);

  it("applies migrations and round-trips a row", async () => {
    const db = testDb();
    await db.auditLog.create({
      data: { entityType: "Harness", entityId: "1", action: "create" },
    });
    const found = await db.auditLog.findFirst({
      where: { entityType: "Harness" },
    });
    expect(found?.action).toBe("create");
  });

  it("truncates between tests", async () => {
    expect(await testDb().auditLog.count()).toBe(0);
  });
});
