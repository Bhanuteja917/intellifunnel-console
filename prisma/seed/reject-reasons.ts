import type { PrismaClient, RejectReasonCategory } from "@prisma/client";

type Seed = {
  code: string;
  label: string;
  category: RejectReasonCategory;
  isPartnerReplaceable: boolean;
};

/**
 * FR-IN-5: free-text reject reasons are not permitted, so this vocabulary is
 * the whole set. isPartnerReplaceable drives FR-VF-4's replacement obligation:
 * a partner owes a replacement only where the failure was theirs to avoid.
 */
export const REJECT_REASONS: readonly Seed[] = [
  { code: "MISSING_REQUIRED_FIELD", label: "Required field missing", category: "dataQuality", isPartnerReplaceable: true },
  { code: "INVALID_EMAIL_FORMAT", label: "Invalid email format", category: "dataQuality", isPartnerReplaceable: true },
  { code: "INVALID_PHONE_FORMAT", label: "Invalid phone format", category: "dataQuality", isPartnerReplaceable: true },
  { code: "GENERIC_EMAIL_DOMAIN", label: "Personal or generic email domain", category: "dataQuality", isPartnerReplaceable: true },
  { code: "ICP_INDUSTRY_MISMATCH", label: "Industry outside ICP", category: "icpMismatch", isPartnerReplaceable: true },
  { code: "ICP_SIZE_MISMATCH", label: "Company size outside ICP", category: "icpMismatch", isPartnerReplaceable: true },
  { code: "ICP_GEO_MISMATCH", label: "Geography outside ICP", category: "icpMismatch", isPartnerReplaceable: true },
  { code: "ICP_SENIORITY_MISMATCH", label: "Seniority or title outside ICP", category: "icpMismatch", isPartnerReplaceable: true },
  { code: "NOT_ON_TARGET_ACCOUNT_LIST", label: "Account not on the target account list", category: "icpMismatch", isPartnerReplaceable: true },
  { code: "SUPPRESSED_ACCOUNT", label: "Account is suppressed", category: "suppression", isPartnerReplaceable: true },
  { code: "SUPPRESSED_CONTACT", label: "Contact is suppressed", category: "suppression", isPartnerReplaceable: true },
  { code: "DO_NOT_CONTACT", label: "On the client do-not-contact list", category: "suppression", isPartnerReplaceable: true },
  { code: "DUPLICATE_IN_CAMPAIGN", label: "Duplicate within the campaign", category: "duplicate", isPartnerReplaceable: true },
  { code: "DUPLICATE_CROSS_CAMPAIGN", label: "Duplicate across the client's live campaigns", category: "duplicate", isPartnerReplaceable: true },
  { code: "ACCOUNT_CAP_REACHED", label: "Per-account lead cap reached", category: "duplicate", isPartnerReplaceable: false },
  { code: "ALLOCATION_CAP_EXCEEDED", label: "Allocation cap exceeded", category: "duplicate", isPartnerReplaceable: false },
  { code: "CONSENT_MISSING", label: "Consent evidence missing", category: "consent", isPartnerReplaceable: false },
  { code: "CONSENT_INVALID", label: "Consent evidence incomplete or invalid", category: "consent", isPartnerReplaceable: false },
  { code: "QUALIFYING_ANSWER_UNACCEPTABLE", label: "Answer outside acceptable values", category: "qualification", isPartnerReplaceable: true },
  { code: "QUALIFYING_ANSWER_MISSING", label: "Qualifying question unanswered", category: "qualification", isPartnerReplaceable: true },
  { code: "TELE_UNREACHABLE", label: "Unreachable on tele-verification", category: "contactability", isPartnerReplaceable: true },
  { code: "TELE_DENIED_INTEREST", label: "Denied interest on tele-verification", category: "contactability", isPartnerReplaceable: true },
  { code: "INVALID_FIELD_FORMAT", label: "Value does not match the expected format", category: "dataQuality", isPartnerReplaceable: true },
  { code: "VALUE_NOT_ALLOWED", label: "Value is outside the field's allowed values", category: "dataQuality", isPartnerReplaceable: true },
];

export async function seedRejectReasons(db: PrismaClient): Promise<void> {
  for (const reason of REJECT_REASONS) {
    await db.rejectReason.upsert({
      where: { code: reason.code },
      update: { label: reason.label, category: reason.category, isPartnerReplaceable: reason.isPartnerReplaceable },
      create: reason,
    });
  }
}
