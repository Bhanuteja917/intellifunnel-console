import { describe, expect, it } from "vitest";
import { normalizeDomain } from "@/lib/normalise/domain";
import { emailDomain, normalizeEmail } from "@/lib/normalise/email";
import { normalizeCompanyName } from "@/lib/normalise/name";
import { normalizePhone } from "@/lib/normalise/phone";
import { ValidationError } from "@/lib/errors";

describe("normalizeDomain", () => {
  it.each([
    ["https://www.Acme.com/pricing?x=1", "acme.com"],
    ["WWW.ACME.COM.", "acme.com"],
    ["acme.co.uk", "acme.co.uk"],
    ["mail.eu.acme.co.uk", "acme.co.uk"],
    ["http://acme.com", "acme.com"],
    ["  acme.com  ", "acme.com"],
  ])("normalises %s to %s", (input, expected) => {
    expect(normalizeDomain(input)).toBe(expected);
  });

  it.each(["", "not a domain", "localhost", "10.0.0.1"])(
    "returns null for %s",
    (input) => {
      expect(normalizeDomain(input)).toBeNull();
    },
  );
});

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Jane.Doe@Acme.COM ")).toBe("jane.doe@acme.com");
  });

  it("does not strip gmail dots or plus tags", () => {
    // Two addresses that differ only by a plus tag are two different people
    // as far as a client's CRM is concerned. Collapsing them loses leads.
    expect(normalizeEmail("jane+news@acme.com")).toBe("jane+news@acme.com");
  });

  it("rejects a syntactically invalid address", () => {
    expect(() => normalizeEmail("jane(at)acme.com")).toThrow(ValidationError);
  });

  it("extracts the registrable domain", () => {
    expect(emailDomain("Jane@mail.Acme.co.uk")).toBe("acme.co.uk");
  });
});

describe("normalizeCompanyName", () => {
  it.each([
    ["  Acme  Corporation, Inc. ", "acme corporation"],
    ["ACME Ltd", "acme"],
    ["Acme Pvt. Ltd.", "acme"],
    ["Acme GmbH", "acme"],
  ])("normalises %s to %s", (input, expected) => {
    expect(normalizeCompanyName(input)).toBe(expected);
  });
});

describe("normalizePhone", () => {
  it.each([
    // A bare 10-digit number gets the platform's default country code (+91,
    // India — see SETTING_DEFAULTS); an explicit "+" prefix always wins.
    ["9876543210", "+919876543210"],
    ["98765 43210", "+919876543210"],
    ["987-654-3210", "+919876543210"],
    ["+1 (555) 123-4567", "+15551234567"],
    ["+44 20 7946 0958", "+442079460958"],
    ["+33 1 42 68 53 00", "+33142685300"],
    ["  +1 (555) 123-4567  ", "+15551234567"],
  ])("normalises %s to %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(["", "123", "12345", "123456", "123456789012345678", "not a phone"])(
    "returns null for %s",
    (input) => {
      expect(normalizePhone(input)).toBeNull();
    },
  );
});
