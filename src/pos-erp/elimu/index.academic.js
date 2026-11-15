// elimu/index.js — public surface of the academic module (what other Elimu modules / the host app may import).
export { elimuAcademicRoutes, ELIMU_ACADEMIC_NAV } from './routes.academic';
// components other modules can embed
export { default as StudentAcademicHistory } from './report_cards/components/StudentAcademicHistory';
export { default as GuardianContactActions } from './communication/academic/GuardianContactActions';
export { default as AcademicMessageSheet } from './communication/academic/AcademicMessageSheet';
export { default as NotifyGuardiansSheet } from './communication/academic/NotifyGuardiansSheet';
export { default as MarkSheetGrid } from './exams/components/MarkSheetGrid';
// hooks
export { useAcademicAccess } from './academic/hooks/useAcademicAccess';
export { useScope } from './academic/hooks/useScope';
export { useMarkSheet } from './exams/hooks/useMarkSheet';
// services (the "API")
export { academicService } from './academic/services/academicService';
export { examService } from './exams/services/examService';
export { gradingService } from './grading/services/gradingService';
export { reportCardService, nestHistory } from './report_cards/services/reportCardService';
export { printReportCards, printClassReportCards } from './report_cards/services/printReportCards';
export { academicCommService } from './communication/academic/academicCommService';
export { elimuOffline } from './offline/elimuOfflineStore';
// pure engines (testable, reusable for previews)
export { lookupGrade, validateScheme } from './grading/utils/gradingEngine';
export { computeSubjectResult, computeOverall, rank, weightsOk } from './report_cards/utils/resultEngine';
export { reportCardHtml, reportCardsHtml } from './report_cards/utils/reportCardHtml';
