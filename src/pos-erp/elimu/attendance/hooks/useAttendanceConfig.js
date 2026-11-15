// elimu/attendance/hooks/useAttendanceConfig.js -- settings + school's own statuses + absence reasons, loaded once per page.
import { useCallback, useEffect, useState } from 'react';
import { attendanceService } from '../services/attendanceService';
import { allStatuses } from '../utils/statuses';

export const DEFAULT_SETTINGS = { opening_time: '08:00', closing_time: '16:30', grace_minutes: 10, attendance_deadline: '10:00', weekend_days: [6, 7], daily_mode: 'DAILY', require_submit_all_marked: false,
  amendment_requires_reason: true, excused_counts_as_present: false, repeated_absence_threshold: 3, repeated_absence_window_days: 30, repeated_absence_count: 5, notify_absent: true, notify_late: false,
  notify_left_early: true, notify_repeated: true, notify_correction: true, guardian_channels: ['SMS', 'WHATSAPP'], notify_mode: 'PREPARE', early_departure_requires_approval: true, early_departure_approval_before: null };

export function useAttendanceConfig() {
  const [s, setS] = useState({ loading: true, settings: DEFAULT_SETTINGS, custom: [], reasons: [], error: null });
  const load = useCallback(async () => {
    try {
      const [settings, custom, reasons] = await Promise.all([attendanceService.settings().catch(() => DEFAULT_SETTINGS), attendanceService.statuses().catch(() => []), attendanceService.reasons().catch(() => [])]);
      setS({ loading: false, settings: { ...DEFAULT_SETTINGS, ...(settings || {}) }, custom, reasons: reasons.filter((r) => r.is_active), allReasons: reasons, error: null });
    } catch (e) { setS((x) => ({ ...x, loading: false, error: e.message })); }
  }, []);
  useEffect(() => { load(); }, [load]);
  return { ...s, statuses: allStatuses(s.custom), reload: load };
}
