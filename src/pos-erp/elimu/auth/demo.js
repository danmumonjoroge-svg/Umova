// Elimu's demo school (created by elimu_980_demo_school.sql). Public on purpose: it holds sample data only.
import { supabase } from '../services/platform.js';
export const ELIMU_DEMO_CODE = 'DEMOSCH';
export const ELIMU_DEMO_USERNAME = 'demo';
export const ELIMU_DEMO_PASSWORD = 'Demo@1234';
export const isElimuDemo = (tenant) => tenant?.business_code === ELIMU_DEMO_CODE;
/** Fills the demo school once (the database refuses every other school). Never blocks sign-in. */
export async function seedDemoSchoolIfEmpty(tenant) {
  if (!isElimuDemo(tenant)) return { seeded: false };
  try { const { data, error } = await supabase.rpc('elimu_seed_demo'); if (error) throw error; return data || { seeded: false }; }
  catch (e) { console.error('[elimu demo] seeding failed:', e); return { seeded: false, error: e?.message || String(e) }; }
}
