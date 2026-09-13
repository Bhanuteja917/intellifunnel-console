import { describe, expect, it } from "vitest";
import { signPayload, toDeliverableRecord } from "@/lib/delivery/webhook";

describe("signPayload", () => {
  it("is deterministic for the same secret and body", () => {
    const a = signPayload("shh", '{"a":1}');
    const b = signPayload("shh", '{"a":1}');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs when the secret differs", () => {
    expect(signPayload("shh", '{"a":1}')).not.toBe(signPayload("other", '{"a":1}'));
  });
});

describe("toDeliverableRecord", () => {
  it("assembles a DeliverableLeadRecord from a lead+contact+account row", () => {
    const record = toDeliverableRecord({
      id: "lead-1",
      acceptedAt: new Date("2026-01-05T00:00:00.000Z"),
      fieldValuesJson: { companySize: "51-200" },
      contact: { email: "jane@acme.com", firstName: "Jane", lastName: "Doe", phone: null, jobTitle: "VP" },
      account: { name: "Acme", primaryDomain: "acme.com", industry: null, country: "IN" },
    });
    expect(record.contact.email).toBe("jane@acme.com");
    expect(record.account.name).toBe("Acme");
    expect(record.fieldValues.companySize).toBe("51-200");
    expect(record.lead.id).toBe("lead-1");
  });
});
