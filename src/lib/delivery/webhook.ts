import { createHmac } from "node:crypto";
import type { DeliverableLeadRecord } from "@/lib/delivery/field-mapping";

/** HMAC-SHA256 hex digest of `body` using the config's webhookSecret — sent as the X-Delivery-Signature header. */
export function signPayload(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

type LeadForDelivery = {
  id: string;
  acceptedAt: Date | null;
  fieldValuesJson: unknown;
  contact: { email: string; firstName: string | null; lastName: string | null; phone: string | null; jobTitle: string | null };
  account: { name: string; primaryDomain: string | null; industry: string | null; country: string | null };
};

export function toDeliverableRecord(lead: LeadForDelivery): DeliverableLeadRecord {
  return {
    contact: lead.contact,
    account: lead.account,
    lead: { id: lead.id, acceptedAt: lead.acceptedAt },
    fieldValues: (lead.fieldValuesJson as Record<string, string> | null) ?? {},
  };
}
