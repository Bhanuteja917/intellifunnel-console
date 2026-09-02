import { describe, expect, it } from "vitest";
import { appName } from "@/lib/app-info";

describe("bootstrap", () => {
  it("exposes the application name through the @ alias", () => {
    expect(appName).toBe("intellifunnel-console");
  });
});
