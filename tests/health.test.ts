import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, testDb } from "./helpers/db";

describe("health endpoints (NFR-O-3)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.resetModules();
  });

  it("liveness returns 200 without touching the database", async () => {
    const { GET } = await import("@/app/api/health/route");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("readiness returns 200 when the database answers", async () => {
    vi.doMock("@/lib/db", () => ({ db: testDb() }));
    const { GET } = await import("@/app/api/health/ready/route");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ready" });
  });

  it("readiness returns 503 when the database is unreachable", async () => {
    vi.doMock("@/lib/db", () => ({
      db: { $queryRaw: async () => { throw new Error("connection refused"); } },
    }));
    const { GET } = await import("@/app/api/health/ready/route");
    const response = await GET();
    expect(response.status).toBe(503);
    expect((await response.json()).status).toBe("unavailable");
  });
});

describe("structured logging (NFR-O-2)", () => {
  it("emits JSON carrying the correlation id", async () => {
    const { logger } = await import("@/lib/logging/logger");
    const written: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      written.push(String(line));
    });

    logger.info("campaign.transition", { campaignId: "c1", correlationId: "req-1" });

    spy.mockRestore();
    const parsed = JSON.parse(written[0] ?? "{}");
    expect(parsed.level).toBe("info");
    expect(parsed.message).toBe("campaign.transition");
    expect(parsed.correlationId).toBe("req-1");
    expect(parsed.campaignId).toBe("c1");
    expect(typeof parsed.timestamp).toBe("string");
  });
});
