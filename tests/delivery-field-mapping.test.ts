import { describe, expect, it } from "vitest";
import { applyFieldMapping, availableSourceFields, type DeliverableLeadRecord } from "@/lib/delivery/field-mapping";

const record: DeliverableLeadRecord = {
  contact: { email: "jane@acme.com", firstName: "Jane", lastName: "Doe", phone: null, jobTitle: "VP Sales" },
  account: { name: "Acme Inc", primaryDomain: "acme.com", industry: null, country: "IN" },
  lead: { id: "lead-1", acceptedAt: new Date("2026-01-05T00:00:00.000Z") },
  fieldValues: { companySize: "51-200" },
};

describe("applyFieldMapping", () => {
  it("projects fixed contact/account/lead fields and dynamic fieldValues onto target keys", () => {
    const result = applyFieldMapping(
      [
        { source: "contact.email", target: "Email" },
        { source: "contact.firstName", target: "First name" },
        { source: "account.name", target: "Company" },
        { source: "field.companySize", target: "Company size" },
      ],
      record,
    );
    expect(result).toEqual({
      Email: "jane@acme.com",
      "First name": "Jane",
      Company: "Acme Inc",
      "Company size": "51-200",
    });
  });

  it("maps a missing/null source field to null rather than throwing", () => {
    const result = applyFieldMapping(
      [
        { source: "contact.phone", target: "Phone" },
        { source: "field.doesNotExist", target: "Custom" },
      ],
      record,
    );
    expect(result).toEqual({ Phone: null, Custom: null });
  });

  it("lists fixed source fields plus campaign-specific field keys", () => {
    const fields = availableSourceFields(["companySize", "budget"]);
    expect(fields).toContain("contact.email");
    expect(fields).toContain("account.name");
    expect(fields).toContain("field.companySize");
    expect(fields).toContain("field.budget");
  });
});
