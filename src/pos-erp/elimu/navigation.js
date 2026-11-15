// The ONE entry to add to the host's navConfig.js (src/pos-erp/navigation/navConfig.js) when Elimu is merged. Not applied by this folder.
// The host's `perms` list uses its own existing keys; Elimu's module entry is open to anyone who can see school records.
import { GraduationCap } from 'lucide-react';

export const ELIMU_NAV_MODULE = {
  key: 'elimu',
  label: 'School',
  icon: GraduationCap,
  to: '/elimu',
  capability: 'elimu',                                   // new capability flag: shown only for schools (opt-in), see INTEGRATION.md
  perms: ['operations.use', 'employees.manage', 'settings.manage'],
  children: [
    { to: '/elimu/students', label: 'Students' }, { to: '/elimu/admissions', label: 'Admissions' }, { to: '/elimu/classes', label: 'Classes' },
    { to: '/elimu/guardians', label: 'Guardians' }, { to: '/elimu/communication', label: 'Communication' }, { to: '/elimu/settings', label: 'Settings' },
  ],
};
