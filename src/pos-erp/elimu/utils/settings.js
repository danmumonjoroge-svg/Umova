// School settings live in elimu_settings.settings (jsonb). Defaults here MUST match elimu_setting_bool() defaults in the SQL.
export const SETTING_DEFS = [
  { key: 'collect_care_notes',             label: 'Keep short medical / emergency notes on students', hint: 'Off by default. Only staff with care access see them.', default: false },
  { key: 'require_guardian_for_admission', label: 'Require a guardian before a student can be admitted', hint: 'Recommended.', default: true },
  { key: 'require_explicit_consent',       label: 'Only contact guardians who have said yes', hint: 'When on, “Not asked” is treated as no (emergencies excepted).', default: false },
];
export const DEFAULTS = Object.fromEntries(SETTING_DEFS.map((d) => [d.key, d.default]));
export const readSettings = (row) => ({ ...DEFAULTS, ...(row?.settings || {}) });
