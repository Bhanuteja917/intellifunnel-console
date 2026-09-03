import { describe, expect, it } from "vitest";
import { applyMapping, parseDelimited } from "@/lib/lists/csv";
import { ValidationError } from "@/lib/errors";

describe("parseDelimited", () => {
  it("returns headers and rows keyed by header", () => {
    const result = parseDelimited("Company,Domain\nAcme,acme.com\nGlobex,globex.com\n");

    expect(result.headers).toEqual(["Company", "Domain"]);
    expect(result.rows).toEqual([
      { Company: "Acme", Domain: "acme.com" },
      { Company: "Globex", Domain: "globex.com" },
    ]);
  });

  it("trims header whitespace and preserves cell whitespace for later normalisation", () => {
    const result = parseDelimited(" Company , Domain \nAcme  , acme.com\n");
    expect(result.headers).toEqual(["Company", "Domain"]);
    expect(result.rows[0]).toEqual({ Company: "Acme  ", Domain: " acme.com" });
  });

  it("handles quoted fields containing commas", () => {
    const result = parseDelimited('Company,Notes\n"Acme, Inc.",Renewal due\n');
    expect(result.rows[0]?.Company).toBe("Acme, Inc.");
  });

  it("skips fully blank lines", () => {
    const result = parseDelimited("Company\nAcme\n\nGlobex\n");
    expect(result.rows).toHaveLength(2);
  });

  it("rejects an empty file", () => {
    expect(() => parseDelimited("")).toThrow(ValidationError);
  });

  it("rejects duplicate headers", () => {
    expect(() => parseDelimited("Company,Company\nA,B\n")).toThrow(ValidationError);
  });

  it("handles leading blank lines before header row", () => {
    const result = parseDelimited("\nCompany,Domain\nAcme,acme.com\n");
    expect(result.headers).toEqual(["Company", "Domain"]);
    expect(result.rows).toEqual([
      { Company: "Acme", Domain: "acme.com" },
    ]);
  });
});

describe("applyMapping", () => {
  it("renames source columns to canonical keys", () => {
    const mapped = applyMapping(
      { "Company Name": "Acme", "Web Site": "acme.com", Ignored: "x" },
      { "Company Name": "rawName", "Web Site": "rawDomain" },
    );
    expect(mapped).toEqual({ rawName: "Acme", rawDomain: "acme.com" });
  });

  it("omits a mapped column absent from the row", () => {
    const mapped = applyMapping({ "Company Name": "Acme" }, { "Company Name": "rawName", "Web Site": "rawDomain" });
    expect(mapped).toEqual({ rawName: "Acme" });
  });
});
