// utils/comm/index.js — the app's single door into the shared communication engine (the same files the
// scheduler runs on the server), so a message previewed on the phone is word-for-word what automation would write.
export { compose, checkFinal, findBusinessTemplate } from '../../supabase/functions/_shared/comm/engine.js';
export { loadForPurpose } from '../../supabase/functions/_shared/comm/records.js';
export * as loaders from '../../supabase/functions/_shared/comm/loaders.js';
export { PURPOSES, PURPOSE_BY_KEY, CHANNELS, CHANNEL_LABEL, DEFAULT_TEMPLATES, VARIABLE_LABELS, variablesForPurpose } from '../../supabase/functions/_shared/comm/library.js';
export { DEFAULT_PREFS, AUTOMATIONS, AUTOMATION_MODES, MODE_LABEL, normalizePrefs } from '../../supabase/functions/_shared/comm/prefs.js';
export { describeStatus, manualActions, trackingCapability, USER_SETTABLE } from '../../supabase/functions/_shared/comm/statuses.js';
export { smsInfo, toFriendly, fromFriendly, normalizeMsisdn, isValidEmail, contactFor, whatsappFormat } from '../../supabase/functions/_shared/comm/render.js';
export { dateContext, nowInTz, DEFAULT_TZ } from '../../supabase/functions/_shared/comm/dateContext.js';
