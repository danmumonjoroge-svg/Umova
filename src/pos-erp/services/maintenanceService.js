// src/pos-erp/services/maintenanceService.js
// My Maintenance. Costs become a real lb_expenses row (via record_expense, inside
// complete_maintenance_request) — the same table My Spending and the profit report read.
import { posSupabase as supabase } from './posSupabaseClient';

export const CATEGORIES = ['PLUMBING', 'ELECTRICAL', 'PAINTING', 'CARPENTRY', 'APPLIANCE', 'SECURITY', 'CLEANING', 'OTHER'];
export const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
export const STATUS_LABEL = { REPORTED: 'Reported', OPEN: 'Open', ASSIGNED: 'Assigned', IN_PROGRESS: 'In Progress', COMPLETED: 'Completed', CANCELLED: 'Cancelled' };
export const label = (v) => String(v || '').toLowerCase().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

export const maintenanceService = {
  async getAll({ businessId, unitId } = {}) {
    let q = supabase.from('lb_maintenance_requests')
      .select('*, unit:lb_units(id, unit_number), customer:lb_customers(id, name)')
      .order('reported_date', { ascending: false }).order('created_at', { ascending: false });
    if (businessId) q = q.eq('business_id', businessId);
    if (unitId) q = q.eq('unit_id', unitId);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  },

  async create({ tenantId, businessId, unit, description, category, priority, reportedDate, notes, createdBy }) {
    if (!unit?.id) throw new Error('Choose the unit first.');
    if (!description?.trim()) throw new Error('Describe the problem.');
    const { data: ref, error: refErr } = await supabase.rpc('next_doc_number', { p_business_id: businessId, p_prefix: 'MNT' });
    if (refErr) throw refErr;
    const { data, error } = await supabase.from('lb_maintenance_requests').insert({
      tenant_id: tenantId, business_id: businessId, reference_no: ref, unit_id: unit.id, customer_id: unit.customer_id || null,
      description: description.trim(), category, priority, reported_date: reportedDate || undefined, notes: notes || null, created_by: createdBy ?? null,
    }).select().single();
    if (error) throw error;
    return data;
  },

  // Photos live in the private `maintenance-photos` bucket (phase17b). attachment_urls stores the storage PATHS,
  // not URLs — a URL would expire; paths are turned into short-lived signed links when shown.
  async addPhotos({ businessId, job, files }) {
    const paths = [];
    for (const file of files) {
      if (!file.type.startsWith('image/')) throw new Error(`${file.name} is not an image.`);
      if (file.size > 8 * 1024 * 1024) throw new Error(`${file.name} is larger than 8 MB.`);
      const safe = file.name.replace(/[^\w.-]+/g, '_');
      const path = `${businessId}/${job.id}/${crypto.randomUUID()}-${safe}`;
      const { error } = await supabase.storage.from('maintenance-photos').upload(path, file, { contentType: file.type });
      if (error) throw error;
      paths.push(path);
    }
    const next = [...(job.attachment_urls || []), ...paths];
    const { error } = await supabase.from('lb_maintenance_requests').update({ attachment_urls: next, updated_at: new Date().toISOString() }).eq('id', job.id);
    if (error) throw error;
    return next;
  },
  async removePhoto({ job, path }) {
    const { error: sErr } = await supabase.storage.from('maintenance-photos').remove([path]);
    if (sErr) throw sErr;
    const next = (job.attachment_urls || []).filter((p) => p !== path);
    const { error } = await supabase.from('lb_maintenance_requests').update({ attachment_urls: next }).eq('id', job.id);
    if (error) throw error;
    return next;
  },
  async signedUrls(paths = []) {
    if (!paths.length) return {};
    const { data, error } = await supabase.storage.from('maintenance-photos').createSignedUrls(paths, 3600);
    if (error) throw error;
    return Object.fromEntries((data || []).filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]));
  },

  async setStatus(id, status, assignedTo) {
    const { error } = await supabase.rpc('set_maintenance_status', { p_id: id, p_status: status, p_assigned_to: assignedTo ?? null });
    if (error) throw error;
  },

  async complete({ id, labour, materials, other, paymentMethod, completedDate, notes, billing, createdBy }) {
    const { data, error } = await supabase.rpc('complete_maintenance_request', {
      p_id: id, p_labour: Number(labour) || 0, p_materials: Number(materials) || 0, p_other: Number(other) || 0,
      p_payment_method: paymentMethod, p_completed_date: completedDate || new Date().toISOString().slice(0, 10),
      p_notes: notes || null, p_billing: billing || 'BUSINESS', p_created_by: createdBy ?? null,
    });
    if (error) throw error;
    return data;
  },
};
