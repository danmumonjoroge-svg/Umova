// elimu/app/shell/icons.js -- lucide icons by menu / settings key (one place; unknown keys fall back to a grid).
import { Home, Users, UserRound, ClipboardList, Layers, GraduationCap, CalendarCheck, Clock, DoorOpen, ScanLine, Wallet, MessageSquare, CalendarDays, BarChart3, Settings, UserCog, LayoutGrid, School, ShieldCheck } from 'lucide-react';

export const ICONS = {
  dashboard: Home, students: Users, admissions: ClipboardList, classes: Layers, guardians: UserRound, academics: GraduationCap, attendance: CalendarCheck,
  timetable: Clock, rooms: DoorOpen, gate: ScanLine, fees: Wallet, communication: MessageSquare, calendar: CalendarDays, reports: BarChart3, settings: Settings,
  staff: UserCog, school: School, shield: ShieldCheck,
};
export const iconFor = (key) => ICONS[key] || LayoutGrid;
