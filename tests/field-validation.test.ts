import { describe, expect, it } from "vitest";
import { validateFieldValues, type LeadFieldSpecRow } from "@/lib/leads/field-validation";

function spec(overrides: Partial<LeadFieldSpecRow> & { fieldKey: string }): LeadFieldSpecRow {
  return {
    dataType: "string",
    isRequired: false,
    rejectIfMissing: false,
    ...overrides,
  };
}

describe("validateFieldValues", () => {
  it("passes through a valid string field", () => {
    const { values, errors } = validateFieldValues([spec({ fieldKey: "companyName" })], { companyName: "Acme" });
    expect(values).toEqual({ companyName: "Acme" });
    expect(errors).toEqual([]);
  });

  it("flags a missing required+rejectIfMissing field", () => {
    const { errors } = validateFieldValues(
      [spec({ fieldKey: "email", isRequired: true, rejectIfMissing: true })],
      {},
    );
    expect(errors).toEqual([
      { field: "email", rawValue: null, rejectReasonCode: "MISSING_REQUIRED_FIELD", message: "email is required" },
    ]);
  });

  it("does not flag a missing field that isn't rejectIfMissing", () => {
    const { values, errors } = validateFieldValues(
      [spec({ fieldKey: "phone", isRequired: true, rejectIfMissing: false })],
      {},
    );
    expect(values).toEqual({});
    expect(errors).toEqual([]);
  });

  it("normalizes a valid email and rejects a malformed one", () => {
    const ok = validateFieldValues([spec({ fieldKey: "email", dataType: "email" })], { email: " Jane@Acme.COM " });
    expect(ok.values).toEqual({ email: "jane@acme.com" });

    const bad = validateFieldValues([spec({ fieldKey: "email", dataType: "email" })], { email: "not-an-email" });
    expect(bad.errors[0]?.rejectReasonCode).toBe("INVALID_EMAIL_FORMAT");
  });

  it("rejects a generic/personal email domain", () => {
    const { errors } = validateFieldValues([spec({ fieldKey: "email", dataType: "email" })], { email: "jane@gmail.com" });
    expect(errors[0]?.rejectReasonCode).toBe("GENERIC_EMAIL_DOMAIN");
  });

  it("rejects an invalid phone number", () => {
    const { errors } = validateFieldValues([spec({ fieldKey: "phone", dataType: "phone" })], { phone: "not a phone" });
    expect(errors[0]?.rejectReasonCode).toBe("INVALID_PHONE_FORMAT");
  });

  it("parses a number field and rejects a non-numeric value", () => {
    const ok = validateFieldValues([spec({ fieldKey: "headcount", dataType: "number" })], { headcount: "42" });
    expect(ok.values).toEqual({ headcount: 42 });

    const bad = validateFieldValues([spec({ fieldKey: "headcount", dataType: "number" })], { headcount: "abc" });
    expect(bad.errors[0]?.rejectReasonCode).toBe("INVALID_FIELD_FORMAT");
  });

  it("parses a boolean field case-insensitively", () => {
    const { values } = validateFieldValues([spec({ fieldKey: "optedIn", dataType: "boolean" })], { optedIn: "YES" });
    expect(values).toEqual({ optedIn: true });
  });

  it("rejects an invalid boolean value", () => {
    const { errors } = validateFieldValues([spec({ fieldKey: "optedIn", dataType: "boolean" })], { optedIn: "maybe" });
    expect(errors[0]?.rejectReasonCode).toBe("INVALID_FIELD_FORMAT");
  });

  it("parses a date field and rejects an unparseable one", () => {
    const ok = validateFieldValues([spec({ fieldKey: "eventDate", dataType: "date" })], { eventDate: "2026-01-15" });
    expect(typeof ok.values.eventDate).toBe("string");

    const bad = validateFieldValues([spec({ fieldKey: "eventDate", dataType: "date" })], { eventDate: "not a date" });
    expect(bad.errors[0]?.rejectReasonCode).toBe("INVALID_FIELD_FORMAT");
  });

  it("accepts a valid URL and rejects a malformed one", () => {
    const ok = validateFieldValues([spec({ fieldKey: "site", dataType: "url" })], { site: "https://acme.com" });
    expect(ok.values).toEqual({ site: "https://acme.com" });

    const bad = validateFieldValues([spec({ fieldKey: "site", dataType: "url" })], { site: "not a url" });
    expect(bad.errors[0]?.rejectReasonCode).toBe("INVALID_FIELD_FORMAT");
  });

  it("rejects a value not in allowedValues (case-insensitive)", () => {
    const ok = validateFieldValues(
      [spec({ fieldKey: "tier", allowedValues: ["Gold", "Silver"] })],
      { tier: "gold" },
    );
    expect(ok.values).toEqual({ tier: "gold" });

    const bad = validateFieldValues(
      [spec({ fieldKey: "tier", allowedValues: ["Gold", "Silver"] })],
      { tier: "Bronze" },
    );
    expect(bad.errors[0]?.rejectReasonCode).toBe("VALUE_NOT_ALLOWED");
  });

  it("rejects a value that fails validationPattern", () => {
    const bad = validateFieldValues(
      [spec({ fieldKey: "zip", validationPattern: "^\\d{5}$" })],
      { zip: "abc" },
    );
    expect(bad.errors[0]?.rejectReasonCode).toBe("INVALID_FIELD_FORMAT");
  });

  it("treats a malformed validationPattern as a format failure, not a crash", () => {
    const { errors } = validateFieldValues(
      [spec({ fieldKey: "zip", validationPattern: "(unterminated" })],
      { zip: "12345" },
    );
    expect(errors[0]?.rejectReasonCode).toBe("INVALID_FIELD_FORMAT");
  });

  it("validates every spec independently across a row", () => {
    const { values, errors } = validateFieldValues(
      [spec({ fieldKey: "email", dataType: "email" }), spec({ fieldKey: "companyName" })],
      { email: "bad-email", companyName: "Acme" },
    );
    expect(errors).toHaveLength(1);
    expect(values).toEqual({ companyName: "Acme" });
  });
});
