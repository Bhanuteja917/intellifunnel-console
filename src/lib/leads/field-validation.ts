import { normalizeEmail, emailDomain } from "@/lib/normalise/email";
import { normalizePhone } from "@/lib/normalise/phone";
import type { LeadFieldDataType } from "@prisma/client";

export type LeadFieldSpecRow = {
  fieldKey: string;
  dataType: LeadFieldDataType;
  isRequired: boolean;
  rejectIfMissing: boolean;
  allowedValues?: unknown[];
  validationPattern?: string;
};

export type FieldValidationError = {
  field: string;
  rawValue: string | null;
  rejectReasonCode: "MISSING_REQUIRED_FIELD" | "INVALID_EMAIL_FORMAT" | "INVALID_PHONE_FORMAT" | "GENERIC_EMAIL_DOMAIN" | "INVALID_FIELD_FORMAT" | "VALUE_NOT_ALLOWED";
  message: string;
};

export type FieldValidationResult = {
  values: Record<string, unknown>; // fieldKey -> normalized value, ready for fieldValuesJson
  errors: FieldValidationError[];  // empty means the row's field validation passed
};

const GENERIC_EMAIL_DOMAINS = new Set([
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com",
  "icloud.com", "live.com", "msn.com", "protonmail.com",
]);

export function validateFieldValues(specs: LeadFieldSpecRow[], rawRow: Record<string, string>): FieldValidationResult {
  const values: Record<string, unknown> = {};
  const errors: FieldValidationError[] = [];

  for (const spec of specs) {
    const raw = rawRow[spec.fieldKey]?.trim() ?? "";
    const isMissing = raw === "";

    if (isMissing) {
      if (spec.isRequired && spec.rejectIfMissing) {
        errors.push({ field: spec.fieldKey, rawValue: null, rejectReasonCode: "MISSING_REQUIRED_FIELD", message: `${spec.fieldKey} is required` });
      }
      continue; // nothing more to validate on an absent value
    }

    switch (spec.dataType) {
      case "email": {
        let normalized: string;
        try {
          normalized = normalizeEmail(raw);
        } catch {
          errors.push({ field: spec.fieldKey, rawValue: raw, rejectReasonCode: "INVALID_EMAIL_FORMAT", message: `${raw} is not a valid email` });
          break;
        }
        const domain = emailDomain(normalized);
        if (domain !== null && GENERIC_EMAIL_DOMAINS.has(domain)) {
          errors.push({ field: spec.fieldKey, rawValue: raw, rejectReasonCode: "GENERIC_EMAIL_DOMAIN", message: `${domain} is a personal/generic email domain` });
          break;
        }
        values[spec.fieldKey] = normalized;
        break;
      }
      case "phone": {
        const normalized = normalizePhone(raw);
        if (normalized === null) {
          errors.push({ field: spec.fieldKey, rawValue: raw, rejectReasonCode: "INVALID_PHONE_FORMAT", message: `${raw} is not a valid phone number` });
          break;
        }
        values[spec.fieldKey] = normalized;
        break;
      }
      case "number": {
        const n = Number(raw);
        if (!Number.isFinite(n)) {
          errors.push({ field: spec.fieldKey, rawValue: raw, rejectReasonCode: "INVALID_FIELD_FORMAT", message: `${raw} is not a number` });
          break;
        }
        values[spec.fieldKey] = n;
        break;
      }
      case "boolean": {
        const lower = raw.toLowerCase();
        if (!["true", "false", "yes", "no", "1", "0"].includes(lower)) {
          errors.push({ field: spec.fieldKey, rawValue: raw, rejectReasonCode: "INVALID_FIELD_FORMAT", message: `${raw} is not a boolean` });
          break;
        }
        values[spec.fieldKey] = ["true", "yes", "1"].includes(lower);
        break;
      }
      case "date": {
        const d = new Date(raw);
        if (Number.isNaN(d.getTime())) {
          errors.push({ field: spec.fieldKey, rawValue: raw, rejectReasonCode: "INVALID_FIELD_FORMAT", message: `${raw} is not a date` });
          break;
        }
        values[spec.fieldKey] = d.toISOString();
        break;
      }
      case "url": {
        try {
          new URL(raw);
          values[spec.fieldKey] = raw;
        } catch {
          errors.push({ field: spec.fieldKey, rawValue: raw, rejectReasonCode: "INVALID_FIELD_FORMAT", message: `${raw} is not a valid URL` });
        }
        break;
      }
      case "string":
      default:
        values[spec.fieldKey] = raw;
        break;
    }

    // allowedValues / validationPattern apply on top of a type-valid value (skip if the type check above already errored this field).
    const alreadyErroredThisField = errors.some((e) => e.field === spec.fieldKey);
    if (!alreadyErroredThisField) {
      if (spec.allowedValues !== undefined && spec.allowedValues.length > 0 && !spec.allowedValues.some((v) => String(v).toLowerCase() === raw.toLowerCase())) {
        errors.push({ field: spec.fieldKey, rawValue: raw, rejectReasonCode: "VALUE_NOT_ALLOWED", message: `${raw} is not one of the allowed values for ${spec.fieldKey}` });
        delete values[spec.fieldKey];
      } else if (spec.validationPattern !== undefined) {
        let patternMatches: boolean;
        try {
          patternMatches = new RegExp(spec.validationPattern).test(raw);
        } catch {
          patternMatches = false; // malformed pattern config — treat as a format failure, don't crash the whole row
        }
        if (!patternMatches) {
          errors.push({ field: spec.fieldKey, rawValue: raw, rejectReasonCode: "INVALID_FIELD_FORMAT", message: `${raw} does not match the required pattern for ${spec.fieldKey}` });
          delete values[spec.fieldKey];
        }
      }
    }
  }

  return { values, errors };
}
