// The shape of the school staff menu:  group > subgroup > (sub-subgroup) > page.   `to` is relative to the school base path.
// soon: true = planned, not built. Change this file to regroup the menu; no page code needs to change.
export const SCHOOL_TREE = {
  key: 'menu', label: 'Menu', children: [
    { key: 'administration', label: 'Administration', icon: 'Building2', desc: 'Staff, communication, calendar and reports', children: [
      { key: 'staff-access', label: 'Staff & access', desc: 'Who can do what', children: [
        { key: 'staff', label: 'Staff accounts', desc: 'Add staff and give them school roles', to: 'staff', ownerOnly: true },
        { key: 'roles', label: 'Roles & permissions', desc: 'What each role can see and do', to: 'access', anyOf: ['roles.view'] },
      ] },
      { key: 'communication', label: 'Communication', desc: 'Messages and notices', children: [
        { key: 'messages', label: 'Messages to parents', desc: 'SMS, email and message history', to: 'communication', anyOf: ['comms.history'] },
        { key: 'notices', label: 'Notices & announcements', desc: 'Circulars to parents and staff', to: 'notices' },
      ] },
      { key: 'calendar', label: 'Calendar & events', desc: 'Term dates, events and trips', children: [
        { key: 'school-calendar', label: 'School calendar', desc: 'Terms, holidays, events and amounts expected', to: 'calendar', anyOf: ['calendar.view'] },
        { key: 'trips', label: 'Trips & activities', desc: 'Plan trips and collect parent consent', to: 'trips', anyOf: ['calendar.view', 'calendar.manage'] },
      ] },
      { key: 'reports', label: 'Reports & analytics', desc: 'Summaries for management', children: [
        { key: 'att-reports', label: 'Attendance reports', desc: 'Attendance by class, day and student', to: 'reports', anyOf: ['reports.view'] },
        { key: 'mgmt', label: 'Management dashboard', desc: 'Enrolment, attendance, fees and results at a glance', to: 'dashboard', anyOf: ['settings.manage', 'marks.manage_all', 'finance.report', 'attendance.view_all', 'students.manage', 'library.manage'] },
      ] },
    ] },
    { key: 'registration', label: 'Registration', icon: 'ClipboardList', desc: 'Admissions, students, guardians, classes and old data', children: [
      { key: 'admissions', label: 'Admissions', desc: 'New applications', children: [
        { key: 'applications', label: 'Applications', desc: 'Receive, review and decide applications', to: 'admissions', anyOf: ['admissions.view'] },
        { key: 'letters', label: 'Admission letters', desc: 'Offer letters and joining instructions', to: 'admission-letters', anyOf: ['admissions.manage', 'admissions.decide'] },
      ] },
      { key: 'students', label: 'Students', desc: 'The student register', children: [
        { key: 'register', label: 'Student register', desc: 'Find, add and edit students', to: 'students', anyOf: ['students.view'] },
        { key: 'promotion', label: 'Promotion & class changes', desc: 'Move a class up at year end', to: 'promotion', anyOf: ['enrollment.manage'] },
        { key: 'leavers', label: 'Transfers & leavers', desc: 'Withdrawals, transfers and graduation', to: 'leavers', anyOf: ['students.manage'] },
      ] },
      { key: 'guardians', label: 'Guardians', desc: 'Parents and guardians', children: [
        { key: 'guardian-register', label: 'Guardian register', desc: 'Contacts and what each guardian may see', to: 'guardians', anyOf: ['guardians.view'] },
      ] },
      { key: 'structure', label: 'Classes & streams', desc: 'School structure', children: [
        { key: 'classes', label: 'Classes and streams', desc: 'Set up and view classes', to: 'classes', anyOf: ['structure.view'] },
      ] },
      { key: 'migration', label: 'Bring in old data', desc: 'Move from your old system using Excel or CSV', children: [
        { key: 'mig-people', label: 'Students & guardians', desc: 'Admission numbers, names, classes, contacts', children: [
          { key: 'imp-students', label: 'Import students', desc: 'Upload the student list from Excel', to: 'import/students', anyOf: ['students.manage'] },
          { key: 'imp-guardians', label: 'Import guardians', desc: 'Guardians come in the same file as students', to: 'import/students', anyOf: ['students.manage'] },
        ] },
        { key: 'mig-money', label: 'Fees & balances', desc: 'Opening balances from the old system', children: [
          { key: 'imp-balances', label: 'Import fee balances', desc: 'Opening balance per student', to: 'import/balances', anyOf: ['finance.bill'] },
        ] },
        { key: 'mig-results', label: 'Exam results', desc: 'Past marks and results', children: [
          { key: 'imp-results', label: 'Import past results', desc: 'Marks per student, subject and exam', to: 'import/results', anyOf: ['marks.manage_all'] },
        ] },
        { key: 'mig-log', label: 'Import history', desc: 'What was uploaded, by whom, and any rows refused', children: [
          { key: 'imp-log', label: 'Import log', desc: 'Every import with its result', to: 'import/log', anyOf: ['students.manage', 'finance.bill', 'marks.manage_all'] },
        ] },
      ] },
    ] },
    { key: 'academics', label: 'Academics', icon: 'GraduationCap', desc: 'Curriculum, timetable, attendance, exams and learning materials', children: [
      { key: 'curriculum', label: 'Curriculum', desc: 'Subjects and who teaches them', children: [
        { key: 'overview', label: 'Academics overview', desc: 'Where things stand this term', to: 'academics', anyOf: ['structure.view'] },
        { key: 'subjects', label: 'Subjects', desc: 'Subjects offered by class', to: 'academics/subjects', anyOf: ['structure.view'] },
        { key: 'allocations', label: 'Teacher allocations', desc: 'Which teacher teaches which subject', to: 'academics/allocations', anyOf: ['structure.view'] },
        { key: 'acad-setup', label: 'Years, terms and setup', desc: 'Academic years and terms', to: 'academics/setup', anyOf: ['structure.view'] },
      ] },
      { key: 'timetable', label: 'Timetable & rooms', desc: 'Lessons, changes and classrooms', children: [
        { key: 'tt', label: 'Class timetable', desc: 'Weekly lessons', to: 'timetable', anyOf: ['timetable.view'] },
        { key: 'tt-changes', label: 'Changes & cover', desc: 'Swaps, absences and cover lessons', to: 'timetable/changes', anyOf: ['timetable.view'] },
        { key: 'tt-setup', label: 'Timetable setup', desc: 'Periods and lesson slots', to: 'timetable/setup', anyOf: ['timetable.manage'] },
        { key: 'rooms', label: 'Rooms (live)', desc: 'Which classrooms are free right now', to: 'rooms', anyOf: ['timetable.view'] },
      ] },
      { key: 'attendance', label: 'Attendance', desc: 'Daily registers and absences', children: [
        { key: 'att-dash', label: 'Attendance today', desc: 'Present, late and absent', to: 'attendance', anyOf: ['attendance.take_own', 'attendance.take_any', 'attendance.view_all'] },
        { key: 'att-take', label: 'Take attendance', desc: 'Mark a class register', to: 'attendance/take', anyOf: ['attendance.take_own', 'attendance.take_any'] },
        { key: 'att-abs', label: 'Absence follow-up', desc: 'Cases and calls to parents', to: 'absences', anyOf: ['absence.manage'] },
        { key: 'att-set', label: 'Attendance settings', desc: 'Cut-off times and rules', to: 'attendance/settings', anyOf: ['settings.manage', 'attendance.view_all'] },
      ] },
      { key: 'exams', label: 'Exams & results', desc: 'From setting exams to report cards', children: [
        { key: 'ex-setup', label: 'Exam setup', desc: 'Exams, grading and the exam timetable', children: [
          { key: 'assessments', label: 'Exams & assessments', desc: 'Create tests, CATs and exams', to: 'academics/assessments', anyOf: ['structure.view'] },
          { key: 'grading', label: 'Grading schemes', desc: 'Grade boundaries and points', to: 'academics/grading', anyOf: ['structure.view'] },
          { key: 'ex-timetable', label: 'Exam timetable', desc: 'When and where each paper is sat (shown to parents)', to: 'academics/exam-timetable', anyOf: ['structure.view'] },
        ] },
        { key: 'ex-marks', label: 'Marks', desc: 'Entering marks', children: [
          { key: 'my-assess', label: 'My assessments', desc: 'Enter marks for your subjects', to: 'academics/my-assessments', anyOf: ['structure.view'] },
        ] },
        { key: 'ex-results', label: 'Results & reports', desc: 'Term results, report cards and progress', children: [
          { key: 'term-results', label: 'Term results', desc: 'Class and subject results', to: 'academics/results', anyOf: ['structure.view'] },
          { key: 'report-cards', label: 'Report cards', desc: 'Current results per student; publish to parents', to: 'academics/report-cards', anyOf: ['structure.view'] },
          { key: 'progress', label: 'Progress reports', desc: 'Every exam a student has done, with a progress graph', to: 'academics/progress', anyOf: ['structure.view'] },
        ] },
      ] },
      { key: 'learning', label: 'Learning materials', desc: 'Study materials, assignments and revision', children: [
        { key: 'lm-materials', label: 'Study materials', desc: 'Upload notes and revision papers by class and subject', to: 'academics/materials', anyOf: ['academic.access', 'marks.manage_all'] },
        { key: 'lm-assign', label: 'Assignments', desc: 'Set work, receive submissions, mark', to: 'academics/assignments', anyOf: ['academic.access', 'marks.manage_all'] },
        { key: 'lm-submissions', label: 'Student submissions', desc: 'Work handed in by students', to: 'academics/assignments', anyOf: ['academic.access', 'marks.manage_all'] },
        { key: 'lm-library', label: 'E-library', desc: 'Past papers, revision books and school documents', to: 'academics/library', anyOf: ['academic.access', 'marks.manage_all'] },
        { key: 'lm-books', label: 'Book lending', desc: 'Issue and return books, overdue and fines', to: 'academics/books', anyOf: ['library.manage'] },
      ] },
    ] },
    { key: 'security', label: 'Security', icon: 'ShieldCheck', desc: 'Gate, gate passes, rooms and access', children: [
      { key: 'gate', label: 'Gate', desc: 'Arrivals and departures', children: [
        { key: 'gate-check', label: 'Gate check-in', desc: 'Register arrivals at the gate', to: 'gate', anyOf: ['attendance.take_any'] },
        { key: 'gate-exit', label: 'Exit log', desc: 'Who left, when and who allowed it', to: 'gate-exits', anyOf: ['attendance.view_all', 'attendance.take_any'] },
      ] },
      { key: 'passes', label: 'Gate passes', desc: 'Permission to leave school', children: [
        { key: 'pass-new', label: 'Issue a gate pass', desc: 'Teacher writes a pass (for example a sick student)', to: 'gate-passes', anyOf: ['attendance.take_own', 'attendance.take_any'] },
        { key: 'pass-parent', label: 'Waiting for parent', desc: 'Passes the parent has not yet answered', to: 'gate-passes?tab=all', anyOf: ['attendance.view_all', 'attendance.take_any'] },
        { key: 'pass-gate', label: 'Cleared to leave', desc: 'Passes approved by teacher and parent, for the gate officer', to: 'gate-passes?tab=gate', anyOf: ['attendance.take_any'] },
      ] },
      { key: 'access', label: 'Access & audit', desc: 'Roles and activity', children: [
        { key: 'roles2', label: 'Roles & permissions', desc: 'What each role can see and do', to: 'access', anyOf: ['roles.view'] },
        { key: 'audit', label: 'Activity log', desc: 'Who did what', to: 'activity', anyOf: ['settings.manage'] },
      ] },
    ] },
    { key: 'finance', label: 'Finance', icon: 'Wallet', desc: 'Fees, payables, bank, assets, payroll and statements', children: [
      { key: 'fin-hub', label: 'Open Finance', desc: 'Fees, receivables, payables, bank, enterprises, accounting, assets, reports', to: 'finance', anyOf: ['finance.view', 'finance.collect', 'finance.bill', 'finance.approve', 'finance.report', 'finance.configure'] },
    ] },
    { key: 'parents', label: 'Parents portal', icon: 'Users', desc: 'What parents see and send, controlled from here', children: [
      { key: 'pp-see', label: 'What parents see', desc: 'Results, timetable and fees shown to parents', children: [
        { key: 'pp-reports', label: 'Publish report cards', desc: 'Release current results to parents', to: 'academics/report-cards', anyOf: ['structure.view'] },
        { key: 'pp-extimetable', label: 'Exam timetable for parents', desc: 'Set and publish the dates parents see', to: 'academics/exam-timetable', anyOf: ['structure.view'] },
        { key: 'pp-access', label: 'Guardian access', desc: 'Which guardian may see results and fees', to: 'guardians', anyOf: ['guardians.view'] },
      ] },
      { key: 'pp-requests', label: 'Requests from parents', desc: 'Things parents answer or send', children: [
        { key: 'pp-passes', label: 'Gate pass answers', desc: 'Parent accepted or refused a leave request', to: 'gate-passes?tab=all', anyOf: ['attendance.view_all', 'attendance.take_any'] },
        { key: 'pp-work', label: 'Assignment submissions', desc: 'Work uploaded through the portal', to: 'academics/assignments', anyOf: ['academic.access', 'marks.manage_all'] },
      ] },
      { key: 'pp-contact', label: 'Contacting parents', desc: 'Messages', children: [
        { key: 'pp-messages', label: 'Messages', desc: 'SMS, email and history', to: 'communication', anyOf: ['comms.history'] },
      ] },
    ] },
    { key: 'settings', label: 'Settings', icon: 'Settings', desc: 'School profile, academic setup and data', children: [
      { key: 'set-school', label: 'School profile', desc: 'Name, code and contacts', children: [
        { key: 'set-main', label: 'School settings', desc: 'School details and options', to: 'settings', anyOf: ['settings.manage'] },
      ] },
      { key: 'set-acad', label: 'Academic setup', desc: 'Years, terms and grading', children: [
        { key: 'set-terms', label: 'Years and terms', desc: 'Academic years and terms', to: 'academics/setup', anyOf: ['structure.view'] },
        { key: 'set-grading', label: 'Grading schemes', desc: 'Grade boundaries and points', to: 'academics/grading', anyOf: ['structure.view'] },
      ] },
      { key: 'set-data', label: 'Data & storage', desc: 'Files and backups', children: [
        { key: 'set-storage', label: 'File storage', desc: 'Space used by study materials and uploads', to: 'file-storage', anyOf: ['settings.manage'] },
        { key: 'set-export', label: 'Export & backup', desc: 'Download your data', soon: true },
      ] },
    ] },
  ],
};
