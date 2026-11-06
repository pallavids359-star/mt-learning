export type StaffRole =
  | 'SUPER_ADMIN'
  | 'COLLEGE_ADMIN'
  | 'PRINCIPAL'
  | 'TEACHER'
  | 'EXAM_COORDINATOR'
  | 'HOSTEL_WARDEN'
  | 'DEVICE_ADMIN';
export type AccountStatus = 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
export type PucYear = 'PUC_1' | 'PUC_2';
export type Gender = 'MALE' | 'FEMALE' | 'OTHER';
export type TabletStatus = 'IN_STOCK' | 'ASSIGNED' | 'UNDER_REPAIR' | 'LOST' | 'RETIRED';

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Me {
  kind: 'staff';
  id: string;
  email: string;
  fullName: string;
  role: StaffRole;
  mustChangePassword: boolean;
  permissions: string[];
}

export interface Staff {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  role: StaffRole;
  status: AccountStatus;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AcademicYear {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
}

export interface Subject {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

export interface SectionSummary {
  id: string;
  name: string;
  studentCount: number;
}

export interface ClassGroup {
  id: string;
  academicYearId: string;
  pucYear: PucYear;
  stream: string;
  name: string;
  sections: SectionSummary[];
  subjects: Subject[];
  studentCount: number;
}

export interface Hostel {
  id: string;
  name: string;
  wardenId: string | null;
  wardenName: string | null;
  studentCount: number;
}

export interface Student {
  id: string;
  studentCode: string;
  fullName: string;
  dateOfBirth: string | null;
  gender: Gender | null;
  hasPhoto: boolean;
  guardianName: string | null;
  guardianPhone: string | null;
  rollNumber: string;
  roomNumber: string | null;
  status: AccountStatus;
  mustChangePassword: boolean;
  hasPin: boolean;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  section: { id: string; name: string };
  classGroup: { id: string; name: string; pucYear: PucYear; stream: string };
  hostel: { id: string; name: string } | null;
  tablet: { id: string; serialNumber: string; model: string; lastSeenAt: string | null } | null;
}

export interface Tablet {
  id: string;
  serialNumber: string;
  assetTag: string | null;
  model: string;
  androidVersion: string | null;
  appVersion: string | null;
  status: TabletStatus;
  assignedAt: string | null;
  lastSeenAt: string | null;
  notes: string | null;
  createdAt: string;
  student: { id: string; studentCode: string; fullName: string } | null;
}

export interface AuditEntry {
  id: string;
  actorType: 'STAFF' | 'STUDENT' | 'SYSTEM';
  actorId: string | null;
  actorLabel: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
}

export interface DashboardSummary {
  generatedAt: string;
  academicYear: { id: string; name: string } | null;
  students: { active: number; suspended: number; deactivated: number; activeWithoutTablet: number };
  tablets: { total: number; byStatus: Partial<Record<TabletStatus, number>>; staleAssigned: number; staleAfterDays: number };
  classes: { classId: string; className: string; pucYear: PucYear; sections: number; students: number }[];
  subjects: number;
  hostels: number;
  staffByRole: Partial<Record<StaffRole, number>>;
  recentActivity: { id: string; action: string; actorLabel: string | null; entityType: string | null; createdAt: string }[] | null;
  studentsByYear: Partial<Record<PucYear, number>>;
  tabletsOnlineToday: number;
  attendance: {
    today: { date: string; percent: number | null; present: number; absent: number } | null;
    trend: TrendPoint[] | null;
    belowThreshold: number;
    threshold: number;
    lowStudents: LowAttendance[];
  } | null;
  tests: { submittedThisWeek: number; averagePercentThisWeek: number | null; pendingReviews: number; openNow: number } | null;
  classPerformance: { classId: string; className: string; sectionName: string; averagePercent: number; attempts: number }[] | null;
}

export interface ImportResult {
  dryRun: boolean;
  totalRows: number;
  valid: boolean;
  errors: { row: number; studentCode?: string; messages: string[] }[];
  created: number;
  credentials: { studentCode: string; fullName: string; temporaryPassword: string }[];
}

// ============================================================ Phase 2

export type MaterialKind = 'PDF' | 'VIDEO' | 'SLIDES' | 'LINK';
export type TestState = 'draft' | 'upcoming' | 'open' | 'closed';
export type ReviewStatus = 'NONE' | 'PENDING' | 'ACCEPTED' | 'REJECTED';
export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'LEAVE';
export type NoticeCategory = 'GENERAL' | 'EXAM' | 'HOSTEL' | 'HOLIDAY' | 'EVENT';
export type AudienceType = 'ALL' | 'CLASS' | 'SECTION' | 'HOSTEL';

export interface Assignment {
  subjectId: string;
  subjectName: string;
  teacherId: string;
  teacherName: string;
}

export interface TimetableSlot {
  id?: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  subjectId: string;
  subjectCode?: string;
  subjectName?: string;
  teacherId: string | null;
  teacherName?: string | null;
  topic: string | null;
  room: string | null;
}

export interface Holiday {
  id: string;
  date: string;
  name: string;
}

export interface Material {
  id: string;
  classId: string;
  className: string;
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  chapter: string;
  title: string;
  description: string | null;
  kind: MaterialKind;
  hasFile: boolean;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  durationMin: number | null;
  externalUrl: string | null;
  allowOffline: boolean;
  publishedAt: string | null;
  createdByName: string | null;
  createdAt: string;
  completedCount: number;
  openedCount: number;
  studentCount: number;
}

export interface Question {
  id?: string;
  text: string;
  options: string[];
  correctIndex: number;
  marks: number;
  topic: string | null;
  explanation: string | null;
  /** GenPrep question this was copied from. */
  bankQuestionId?: string | null;
  /** Subject of the question in an exam test. */
  subject?: string | null;
}

export type TestAudience = 'PUC_1' | 'PUC_2' | 'BOTH';
export type ExamCode = 'NEET' | 'JEE' | 'KCET';

export interface TestBase {
  id: string;
  /** Older tests only. */
  classId: string | null;
  subjectId: string | null;
  audience: TestAudience | null;
  examCode: ExamCode | null;
  subjects: string[];
  title: string;
  instructions: string | null;
  durationMin: number;
  opensAt: string;
  closesAt: string;
  allowOffline: boolean;
  negativeMarks: number;
  instantResults: boolean;
  publishedAt: string | null;
  resultsReleasedAt: string | null;
  createdAt: string;
  state: TestState;
}

export interface TestSummary extends TestBase {
  className: string;
  subjectCode: string;
  subjectName: string;
  createdByName: string | null;
  questionCount: number;
  submittedCount: number;
  pendingReviewCount: number;
  averagePercent: number | null;
  studentCount: number;
}

export interface TestDetail extends TestBase {
  className: string;
  subjectCode: string;
  subjectName: string;
  attemptCount: number;
  questions: (Question & { id: string; position: number })[];
}

export interface AttemptRow {
  id: string;
  studentId: string;
  studentCode: string;
  studentName: string;
  sectionName: string;
  mode: 'ONLINE' | 'OFFLINE';
  startedAt: string;
  submittedAt: string | null;
  clientSubmittedAt: string | null;
  elapsedSec: number | null;
  score: number | null;
  maxScore: number | null;
  percent: number | null;
  correctCount: number | null;
  reviewStatus: ReviewStatus;
  reviewReason: string | null;
}

export interface TestResults {
  test: TestBase & { questionCount: number };
  summary: {
    eligible: number;
    started: number;
    submitted: number;
    counted: number;
    pendingReview: number;
    averagePercent: number | null;
    highestPercent: number | null;
    medianSeconds: number | null;
  };
  perQuestion: {
    questionId: string;
    position: number;
    text: string;
    topic: string | null;
    correctIndex: number;
    answered: number;
    correct: number;
    correctPercent: number | null;
    optionCounts: number[];
  }[];
  attempts: AttemptRow[];
}

export interface PendingReview {
  attemptId: string;
  testId: string;
  testTitle: string;
  studentName: string;
  studentCode: string;
  mode: 'ONLINE' | 'OFFLINE';
  clientSubmittedAt: string | null;
  submittedAt: string | null;
  reviewReason: string | null;
  score: number | null;
  maxScore: number | null;
}

export interface RosterStudent {
  studentId: string;
  studentCode: string;
  fullName: string;
  rollNumber: string;
  roomNumber: string | null;
  className: string;
  sectionName: string;
  status: AttendanceStatus | null;
  note: string | null;
}

export interface Roster {
  session: { id: string; updatedAt: string; takenByName: string | null } | null;
  holiday: string | null;
  canCorrect: boolean;
  students: RosterStudent[];
}

export interface AttendanceSessionRow {
  id: string;
  kind: 'CLASS' | 'HOSTEL';
  date: string;
  label: string;
  sectionName: string | null;
  className: string | null;
  hostelName: string | null;
  takenByName: string | null;
  updatedAt: string;
  present: number;
  absent: number;
  leave: number;
}

export interface TrendPoint {
  date: string;
  present: number;
  absent: number;
  percent: number | null;
}

export interface LowAttendance {
  studentId: string;
  studentCode: string;
  fullName: string;
  className: string;
  sectionName: string;
  guardianPhone: string | null;
  present: number;
  absent: number;
  percent: number | null;
}

export interface CalendarDay {
  date: string;
  status: 'PRESENT' | 'ABSENT' | 'LEAVE' | 'PARTIAL' | 'HOLIDAY' | null;
  holiday: string | null;
  sessions: { label: string; kind: string; status: AttendanceStatus; note: string | null }[];
}

export interface StudentCalendar {
  month: string;
  today: string;
  days: CalendarDay[];
  monthPercent: number | null;
  yearPercent: number | null;
  daysPresent: number;
  daysRecorded: number;
}

export interface Notice {
  id: string;
  title: string;
  body: string;
  category: NoticeCategory;
  audienceType: AudienceType;
  audienceId: string | null;
  audienceName: string;
  audienceSize: number;
  readCount: number;
  postedBy: string | null;
  postedByLabel: string;
  publishedAt: string;
  expiresAt: string | null;
}

export interface LiveClass {
  id: string;
  classId: string;
  className: string;
  sectionId: string | null;
  sectionName: string | null;
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  teacherId: string | null;
  teacherName: string | null;
  title: string;
  startsAt: string;
  endsAt: string;
  joinUrl: string;
  recordingMaterialId: string | null;
  cancelledAt: string | null;
  state: 'scheduled' | 'live' | 'ended' | 'cancelled';
}

export interface LiveQuestion {
  id: string;
  authorType: 'STAFF' | 'STUDENT' | 'SYSTEM';
  authorName: string;
  body: string;
  createdAt: string;
}

// ---------------------------------------------------------------- GenPrep question bank

export interface BankExam {
  id: string;
  code: string;
  name: string;
  durationMinutes: number;
  marking: { correct: number; incorrect: number; unanswered: number };
}

export interface BankSubjectTree {
  id: string;
  name: string;
  chapters: { id: string; name: string; classLevel: '11' | '12'; questionCount: number }[];
}

export interface BankLiveQuestion {
  bankQuestionId: string;
  text: string;
  options: string[];
  correctIndex: number;
  marks: number;
  topic: string | null;
  explanation: string | null;
  difficulty: 'easy' | 'medium' | 'hard';
}

export type MonitorStatus = 'active' | 'inactive' | 'time_over' | 'not_started' | 'submitted';

export interface MonitorRow {
  studentId: string;
  studentCode: string;
  studentName: string;
  rollNumber: string | null;
  sectionName: string;
  tablet: string | null;
  attemptId: string | null;
  mode: 'ONLINE' | 'OFFLINE' | null;
  status: MonitorStatus;
  battery: number | null;
  charging: boolean | null;
  currentQuestion: number | null;
  attended: number;
  left: number;
  skipped: number;
  remainingSec: number | null;
  submission: 'not_submitted' | 'submitted' | 'pending_review';
  submittedAt: string | null;
  submittedByStaff: boolean;
  revived: boolean;
  lastActivity: string | null;
  score: number | null;
  maxScore: number | null;
}

export interface MonitorData {
  test: TestDetail & { state: TestState; questionCount: number };
  serverTime: string;
  summary: { total: number; active: number; inactive: number; timeOver: number; notStarted: number; submitted: number; notSubmitted: number };
  students: MonitorRow[];
}

export interface MarksSheet {
  className: string;
  tests: { id: string; title: string; subjectName: string; opensAt: string; maxScore: number }[];
  students: {
    studentId: string;
    studentCode: string;
    studentName: string;
    rollNumber: string;
    sectionName: string;
    marks: Record<string, number | null>;
    testsTaken: number;
    total: number;
    outOf: number;
    percent: number | null;
    rank: number | null;
  }[];
}
