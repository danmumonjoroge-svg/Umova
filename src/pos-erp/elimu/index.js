// Public surface of the Elimu foundation. Later modules import ONLY from here.
export { default as ElimuRoutes } from './routes.jsx';
export { ELIMU_NAV_MODULE } from './navigation.js';
export { registerModule } from './registry.js';

// Reusable communication building blocks (any page, any module)
export { default as ElimuContactActions } from './components/ElimuContactActions.jsx';
export { default as ElimuMessageComposer } from './components/ElimuMessageComposer.jsx';
export { default as ElimuCommunicationPanel, CommunicationHistory } from './components/ElimuCommunicationPanel.jsx';
export { communicationService as ElimuCommunicationService } from './communication/ElimuCommunicationService.js';
export { resolveTemplate as ElimuTemplateResolver, buildVars } from './communication/ElimuTemplateResolver.js';
export { registerPurpose, getPurpose, PURPOSES } from './communication/purposes.js';
export { registerEvent, notificationItems } from './communication/notificationCatalog.js';
export { eligibility as elimuEligibility } from './communication/consent.js';

// Data services other modules read from (never write around them)
export { studentService } from './services/ElimuStudentService.js';
export { guardianService } from './services/ElimuGuardianService.js';
export { admissionService } from './services/ElimuAdmissionService.js';
export { enrollmentService } from './services/ElimuEnrollmentService.js';
export { setupService } from './services/ElimuSetupService.js';

// Hooks and helpers
export { useElimuAccess, useElimuSetup, ElimuAccessProvider } from './hooks/useElimu.js';
export { canElimu } from './utils/permissions.js';
export { normalizeMsisdn, contactFor } from './utils/phone.js';

// ---- Elimu session contract (app/auth) -- see AUTHENTICATION.md ----
// ElimuApp itself is NOT re-exported here (it imports every module); the host imports it from './pos-erp/elimu/ElimuApp.jsx'.
export { ElimuAuthProvider, useElimuSession, useElimuAuth } from './app/auth/ElimuAuthContext.jsx';
export { ELIMU_ROLES, normalizeRole, roleLabel } from './app/auth/roles.js';
export { ElimuAuthError, AUTH_ERROR, authMessage } from './app/auth/authAdapter.js';

// ---- Elimu shell (app/) ----
export { useElimuShell } from './app/shell/ElimuShell.jsx';
export { LoadingState, ErrorState, EmptyState, PageContainer } from './app/shell/states.jsx';
export { SETTINGS_SECTIONS } from './app/navigation/settingsRegistry.js';
export { NAV_GROUPS } from './app/navigation/navModel.js';
