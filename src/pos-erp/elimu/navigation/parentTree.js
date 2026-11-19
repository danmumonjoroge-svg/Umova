// The parent portal menu. `tab` = an existing portal screen; soon = planned. Same node shape as the staff menu (menuKit.js).
export const PARENT_TREE = {
  key: 'home', label: 'Home', children: [
    { key: 'notices', label: 'Notices', icon: 'Megaphone', desc: 'Circulars and announcements from the school', tab: 'notices' },
    { key: 'trips', label: 'Trips', icon: 'CalendarDays', desc: 'Trips and activities: give or refuse consent', tab: 'trips' },
    { key: 'academics', label: 'Academics', icon: 'GraduationCap', desc: 'Exams, results and progress', children: [
      { key: 'extimetable', label: 'Exam timetable', desc: 'When each paper is sat', tab: 'extimetable' },
      { key: 'summary', label: 'Exam results summary', desc: 'Latest exam results', tab: 'results' },
      { key: 'reportcard', label: 'Report card', desc: 'Current results for this term', tab: 'results' },
      { key: 'progress', label: 'Progress report', desc: 'Every exam so far, with a progress graph', tab: 'progress' },
    ] },
    { key: 'learning', label: 'Learning', icon: 'BookOpen', desc: 'Study materials and assignments', children: [
      { key: 'materials', label: 'Study materials', desc: 'Notes and revision papers from teachers', tab: 'materials' },
      { key: 'assignments', label: 'Assignments', desc: 'See work set; upload completed work', tab: 'assignments' },
      { key: 'library', label: 'Library', desc: 'Past papers, revision books and school documents', tab: 'library' },
      { key: 'books', label: 'Borrowed books', desc: 'Books on loan, due dates and fines', tab: 'books' },
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
