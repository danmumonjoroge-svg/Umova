// elimu/grading/services/gradingService.js — grading schemes and bands (configurable; versioned once used).
import { rpc, table } from '../../academic/services/rpc';
import { validateScheme } from '../utils/gradingEngine';

export const gradingService = {
  async listSchemes() {
    const { data, error } = await table('elimu_grading_schemes').select('*, rules:elimu_grading_rules(*)').order('is_default', { ascending: false }).order('name').order('version', { ascending: false });
    if (error) throw new Error(error.message);
    return (data || []).map((s) => ({ ...s, rules: [...(s.rules || [])].sort((a, b) => b.min_percent - a.min_percent) }));
  },
  async createScheme(tenantId, { name, description, applicable_levels, percent_decimals = 0, pass_percent = null }) {
    const { data, error } = await table('elimu_grading_schemes').insert({ tenant_id: tenantId, name, description: description || null, applicable_levels: applicable_levels?.length ? applicable_levels : null, percent_decimals, pass_percent, is_default: false }).select().single();
    if (error) throw new Error(error.message); return data;
  },
  async saveScheme(id, patch) { const { data, error } = await table('elimu_grading_schemes').update(patch).eq('id', id).select().single(); if (error) throw new Error(error.message); return data; },
  /** Replace all bands of an UNUSED scheme. Validated here first for friendly errors; the database re-checks (overlap constraint, lock-when-used). */
  async saveRules(tenantId, schemeId, rules, decimals = 0) {
    const problems = validateScheme(rules, decimals); if (problems.length) throw new Error(problems[0]);
    const del = await table('elimu_grading_rules').delete().eq('scheme_id', schemeId); if (del.error) throw new Error(del.error.message);
    const rows = rules.map((r, i) => ({ tenant_id: tenantId, scheme_id: schemeId, grade: r.grade, min_percent: Number(r.min_percent), max_percent: Number(r.max_percent), grade_point: r.grade_point === '' || r.grade_point == null ? null : Number(r.grade_point), descriptor: r.descriptor || null, remark: r.remark || null, is_pass: r.is_pass ?? true, sort_order: i }));
    const { error } = await table('elimu_grading_rules').insert(rows); if (error) throw new Error(error.message.includes('no_overlap') ? 'Two grade bands overlap.' : error.message);
  },
  newVersion: (schemeId, name) => rpc('elimu_new_scheme_version', { p_scheme: schemeId, p_name: name || null }),
  setDefault: (schemeId) => rpc('elimu_set_default_scheme', { p_scheme: schemeId }),
  validate: (schemeId) => rpc('elimu_validate_scheme', { p_scheme: schemeId }),
};
