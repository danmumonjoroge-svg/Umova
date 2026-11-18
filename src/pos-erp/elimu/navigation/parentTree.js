// The parent portal menu. `tab` = an existing portal screen; soon = planned. Same node shape as the staff menu (menuKit.js).
export const PARENT_TREE = {
  key: 'home', label: 'Home', children: [
    { key: 'academics', label: 'Academics', icon: 'GraduationCap', desc: 'Exams, results and progress', children: [
      { key: 'extimetable', label: 'Exam timetable', desc: 'When each paper is sat', tab: 'extimetable' },
      { key: 'summary', label: 'Exam results summary', desc: 'Latest exam results', tab: 'results' },
      { key: 'reportcard', label: 'Report card', desc: 'Current results for this term', tab: 'results' },
      { key: 'progress', label: 'Progress report', desc: 'Every exam so far, with a progress graph', tab: 'progress' },
    ] },
    { key: 'learning', label: 'Learning', icon: 'BookOpen', desc: 'Study materials and assignments', children: [
      { key: 'materials', label: 'Study materials', desc: 'Notes and revision papers from teachers', soon: true },
      { key: 'assignments', label: 'Assignments', desc: 'See work set; upload completed work', soon: true },
    ] },
    { key: 'attendance', label: 'Attendance', icon: 'CalendarCheck', desc: 'Arrival and absences', children: [
      { key: 'att', label: 'Attendance record', desc: 'Present, late and absent, with arrival time', tab: 'attendance' },
    ] },
    { key: 'gatepass', label: 'Gate pass', icon: 'DoorOpen', desc: 'Permission for your child to leave school', children: [
      { key: 'passes', label: 'Leave requests', desc: 'Accept or refuse when the school asks', tab: 'gatepass' },
    ] },
    { key: 'school', label: 'School life', icon: 'CalendarDays', desc: 'Calendar, events and fees', children: [
      { key: 'cal', label: 'School calendar', desc: 'Events and money expected', tab: 'calendar' },
      { key: 'fees', label: 'Fees', desc: 'Invoices, payments and balance', tab: 'fees' },
    ] },
  ],
};
