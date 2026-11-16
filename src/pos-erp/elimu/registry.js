// How later Elimu modules (AI 2–5) plug in WITHOUT editing this folder's files:
//   import { registerModule } from '../elimu';
//   registerModule({ key: 'attendance', routes: [<Route path="attendance/*" element={...}/>], studentTabs: [...], quickActions: [...] });
// `key` must be one of the NAV_ITEMS keys (academics, attendance, timetable, fees, calendar, reports). Elimu then shows the nav entry,
// mounts the routes under /elimu, adds student-profile tabs and dashboard quick actions.
const modules = new Map();

export function registerModule(m) {
  if (!m?.key) throw new Error('A module needs a key.');
  modules.set(m.key, { routes: [], studentTabs: [], quickActions: [], settingsSections: [], notificationProviders: [], ...m });
}
export const registeredModules = () => modules;
export const moduleRoutes = () => [...modules.values()].flatMap((m) => m.routes);
export const studentTabs = () => [...modules.values()].flatMap((m) => m.studentTabs);       // [{ key, label, render: ({ student }) => node, action }]
export const quickActions = () => [...modules.values()].flatMap((m) => m.quickActions);     // [{ key, label, to, action }]

// ---- shell extras (see app/) ----
//   settingsSections:      [{ key, element: node | ({ base }) => node, action }]   a screen that appears as a section of the ONE Settings hub
//                          (the section's label/description live in app/navigation/settingsRegistry.js, keyed by `key`)
//   notificationProviders: [async ({ can }) => [{ id, tone: 'warn'|'info'|'ok', title, detail?, to? }]]   feed the bell and the notifications page
export const settingsSections = () => [...modules.values()].flatMap((m) => m.settingsSections || []);
export const notificationProviders = () => [...modules.values()].flatMap((m) => m.notificationProviders || []);
export const registeredKeys = () => new Set(modules.keys());
