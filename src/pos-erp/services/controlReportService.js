// Owner control report (phase32_control_report.sql). Read-only.
import { posSupabase as supabase } from './posSupabaseClient';

export const controlReportService = {
  async get(from, to) {
    const { data, error } = await supabase.rpc('pos_control_report', { p_from: from, p_to: to });
    if (error) throw new Error(error.message.includes('NOT_ALLOWED') ? 'You do not have permission to see this report.' : (error.message.replace(/^BAD_DATES:\s*/, '')));
    return data;
  },
};
