export type WeekDay = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";

export type SettingValues = {
  defaultVerificationSlaBusinessDays: number;
  operatingTimezone: string;
  workingDays: WeekDay[];
  personalDataRetentionMonths: number;
  invitationExpiryDays: number;
};

export type SettingKey = keyof SettingValues;

// No admin UI edits these today — they're compiled-in defaults, not a
// runtime-configurable KV store. Re-add `PlatformSetting` if that changes.
export const SETTINGS: SettingValues = {
  defaultVerificationSlaBusinessDays: 3,
  operatingTimezone: "Asia/Kolkata",
  workingDays: ["MO", "TU", "WE", "TH", "FR"],
  personalDataRetentionMonths: 12,
  invitationExpiryDays: 7,
};

export function getSetting<K extends SettingKey>(key: K): SettingValues[K] {
  return SETTINGS[key];
}
