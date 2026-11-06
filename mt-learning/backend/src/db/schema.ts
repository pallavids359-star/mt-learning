/**
 * Manchester Technologies — PU College Tablet Platform
 * Phase 1 data model: identity, roles, academic structure, students, tablets, sessions, audit.
 */
import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const staffRole = pgEnum('staff_role', [
  'SUPER_ADMIN',
  'COLLEGE_ADMIN',
  'PRINCIPAL',
  'TEACHER',
  'EXAM_COORDINATOR',
  'HOSTEL_WARDEN',
  'DEVICE_ADMIN',
]);
export const accountStatus = pgEnum('account_status', ['ACTIVE', 'SUSPENDED', 'DEACTIVATED']);
export const pucYear = pgEnum('puc_year', ['PUC_1', 'PUC_2']);
export const gender = pgEnum('gender', ['MALE', 'FEMALE', 'OTHER']);
export const tabletStatus = pgEnum('tablet_status', ['IN_STOCK', 'ASSIGNED', 'UNDER_REPAIR', 'LOST', 'RETIRED']);
export const principalType = pgEnum('principal_type', ['STAFF', 'STUDENT', 'SYSTEM']);

export type StaffRole = (typeof staffRole.enumValues)[number];
export type AccountStatus = (typeof accountStatus.enumValues)[number];
export type PucYear = (typeof pucYear.enumValues)[number];
export type Gender = (typeof gender.enumValues)[number];
export type TabletStatus = (typeof tabletStatus.enumValues)[number];
export type PrincipalType = (typeof principalType.enumValues)[number];

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => ts('created_at').notNull().defaultNow();
const updatedAt = () =>
  ts('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const staffUsers = pgTable(
  'staff_users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    fullName: text('full_name').notNull(),
    phone: text('phone'),
    role: staffRole('role').notNull(),
    status: accountStatus('status').notNull().default('ACTIVE'),
    passwordHash: text('password_hash').notNull(),
    mustChangePassword: boolean('must_change_password').notNull().default(true),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: ts('locked_until'),
    lastLoginAt: ts('last_login_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('staff_users_email_key').on(sql`lower(${t.email})`), index('staff_users_role_idx').on(t.role)],
);

export const academicYears = pgTable(
  'academic_years',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    isCurrent: boolean('is_current').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('academic_years_name_key').on(t.name),
    // At most one current academic year.
    uniqueIndex('academic_years_single_current').on(t.isCurrent).where(sql`${t.isCurrent} = true`),
  ],
);

/** A class such as "1st PUC Science (PCMB)" within an academic year. */
export const classes = pgTable(
  'classes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    academicYearId: uuid('academic_year_id')
      .notNull()
      .references(() => academicYears.id, { onDelete: 'restrict' }),
    pucYear: pucYear('puc_year').notNull(),
    stream: text('stream').notNull(),
    name: text('name').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('classes_year_name_key').on(t.academicYearId, t.name)],
);

export const sections = pgTable(
  'sections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('sections_class_name_key').on(t.classId, t.name)],
);

export const subjects = pgTable(
  'subjects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('subjects_code_key').on(t.code)],
);

export const classSubjects = pgTable(
  'class_subjects',
  {
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'restrict' }),
  },
  (t) => [primaryKey({ columns: [t.classId, t.subjectId] })],
);

export const hostels = pgTable(
  'hostels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    wardenId: uuid('warden_id').references(() => staffUsers.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('hostels_name_key').on(t.name)],
);

export const students = pgTable(
  'students',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    studentCode: text('student_code').notNull(),
    fullName: text('full_name').notNull(),
    dateOfBirth: date('date_of_birth'),
    gender: gender('gender'),
    photoUrl: text('photo_url'),
    guardianName: text('guardian_name'),
    guardianPhone: text('guardian_phone'),
    /** GenPrep exam the student is preparing for (NEET, JEE, KCET): the question bank's exam id. */
    targetExamId: text('target_exam_id'),
    sectionId: uuid('section_id')
      .notNull()
      .references(() => sections.id, { onDelete: 'restrict' }),
    rollNumber: text('roll_number').notNull(),
    hostelId: uuid('hostel_id').references(() => hostels.id, { onDelete: 'set null' }),
    roomNumber: text('room_number'),
    status: accountStatus('status').notNull().default('ACTIVE'),
    passwordHash: text('password_hash').notNull(),
    pinHash: text('pin_hash'),
    mustChangePassword: boolean('must_change_password').notNull().default(true),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: ts('locked_until'),
    lastLoginAt: ts('last_login_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('students_code_key').on(sql`upper(${t.studentCode})`),
    uniqueIndex('students_section_roll_key').on(t.sectionId, t.rollNumber),
    index('students_status_idx').on(t.status),
    index('students_hostel_idx').on(t.hostelId),
  ],
);

export const tablets = pgTable(
  'tablets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    serialNumber: text('serial_number').notNull(),
    assetTag: text('asset_tag'),
    model: text('model').notNull(),
    androidVersion: text('android_version'),
    appVersion: text('app_version'),
    status: tabletStatus('status').notNull().default('IN_STOCK'),
    studentId: uuid('student_id').references(() => students.id, { onDelete: 'set null' }),
    assignedAt: ts('assigned_at'),
    lastSeenAt: ts('last_seen_at'),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('tablets_serial_key').on(sql`upper(${t.serialNumber})`),
    uniqueIndex('tablets_asset_tag_key').on(t.assetTag),
    uniqueIndex('tablets_student_key').on(t.studentId),
    index('tablets_status_idx').on(t.status),
  ],
);

/** Refresh-token session. Tokens are stored as SHA-256 hashes and rotated on every use. */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    principal: principalType('principal').notNull(),
    staffId: uuid('staff_id').references(() => staffUsers.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id').references(() => students.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    familyId: uuid('family_id').notNull(),
    userAgent: text('user_agent'),
    ip: text('ip'),
    deviceSerial: text('device_serial'),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_key').on(t.tokenHash),
    index('sessions_family_idx').on(t.familyId),
    index('sessions_staff_idx').on(t.staffId),
    index('sessions_student_idx').on(t.studentId),
  ],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorType: principalType('actor_type').notNull(),
    actorId: uuid('actor_id'),
    actorLabel: text('actor_label'),
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    metadata: jsonb('metadata'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_logs_created_idx').on(t.createdAt),
    index('audit_logs_entity_idx').on(t.entityType, t.entityId),
    index('audit_logs_actor_idx').on(t.actorId),
  ],
);

// =====================================================================================
// Phase 2 — teaching, tests, attendance, notices, live classes
// =====================================================================================

export const materialKind = pgEnum('material_kind', ['PDF', 'VIDEO', 'SLIDES', 'LINK']);
export const attemptMode = pgEnum('attempt_mode', ['ONLINE', 'OFFLINE']);
export const reviewStatus = pgEnum('review_status', ['NONE', 'PENDING', 'ACCEPTED', 'REJECTED']);
export const attendanceKind = pgEnum('attendance_kind', ['CLASS', 'HOSTEL']);
export const attendanceStatus = pgEnum('attendance_status', ['PRESENT', 'ABSENT', 'LEAVE']);
export const noticeCategory = pgEnum('notice_category', ['GENERAL', 'EXAM', 'HOSTEL', 'HOLIDAY', 'EVENT']);
export const audienceType = pgEnum('audience_type', ['ALL', 'CLASS', 'SECTION', 'HOSTEL']);

export type MaterialKind = (typeof materialKind.enumValues)[number];
export type AttemptMode = (typeof attemptMode.enumValues)[number];
export type ReviewStatus = (typeof reviewStatus.enumValues)[number];
export type AttendanceKind = (typeof attendanceKind.enumValues)[number];
export type AttendanceStatus = (typeof attendanceStatus.enumValues)[number];
export type NoticeCategory = (typeof noticeCategory.enumValues)[number];
export type AudienceType = (typeof audienceType.enumValues)[number];

/** Which teacher teaches a subject to a class. Used to scope what teachers may manage. */
export const teachingAssignments = pgTable(
  'teaching_assignments',
  {
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    teacherId: uuid('teacher_id')
      .notNull()
      .references(() => staffUsers.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.classId, t.subjectId, t.teacherId] }), index('teaching_teacher_idx').on(t.teacherId)],
);

/** A weekly timetable period for a section. dayOfWeek: 1 = Monday … 7 = Sunday. Times are college-local "HH:MM". */
export const timetableSlots = pgTable(
  'timetable_slots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sectionId: uuid('section_id')
      .notNull()
      .references(() => sections.id, { onDelete: 'cascade' }),
    dayOfWeek: integer('day_of_week').notNull(),
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'restrict' }),
    teacherId: uuid('teacher_id').references(() => staffUsers.id, { onDelete: 'set null' }),
    topic: text('topic'),
    room: text('room'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('timetable_section_day_start_key').on(t.sectionId, t.dayOfWeek, t.startTime)],
);

export const holidays = pgTable(
  'holidays',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    date: date('date').notNull(),
    name: text('name').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('holidays_date_key').on(t.date)],
);

export const materials = pgTable(
  'materials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'restrict' }),
    chapter: text('chapter').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    kind: materialKind('kind').notNull(),
    fileKey: text('file_key'),
    fileName: text('file_name'),
    mimeType: text('mime_type'),
    sizeBytes: integer('size_bytes'),
    durationMin: integer('duration_min'),
    externalUrl: text('external_url'),
    allowOffline: boolean('allow_offline').notNull().default(true),
    publishedAt: ts('published_at'),
    createdBy: uuid('created_by').references(() => staffUsers.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('materials_class_subject_idx').on(t.classId, t.subjectId)],
);

export const materialProgress = pgTable(
  'material_progress',
  {
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    materialId: uuid('material_id')
      .notNull()
      .references(() => materials.id, { onDelete: 'cascade' }),
    openedAt: ts('opened_at'),
    downloadedAt: ts('downloaded_at'),
    completedAt: ts('completed_at'),
  },
  (t) => [primaryKey({ columns: [t.studentId, t.materialId] }), index('material_progress_material_idx').on(t.materialId)],
);

export const tests = pgTable(
  'tests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Older tests: one class and one subject. Exam tests leave these empty and use audience + examCode. */
    classId: uuid('class_id').references(() => classes.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id').references(() => subjects.id, { onDelete: 'restrict' }),
    /** Who writes an exam test: every class of 1st PUC, 2nd PUC, or both (current academic year). */
    audience: text('audience').$type<TestAudience>(),
    /** NEET, JEE or KCET: decides the subjects and the usual marking. */
    examCode: text('exam_code'),
    /** Subjects of an exam test, in paper order. */
    subjectNames: jsonb('subject_names').$type<string[]>(),
    title: text('title').notNull(),
    instructions: text('instructions'),
    durationMin: integer('duration_min').notNull(),
    opensAt: ts('opens_at').notNull(),
    closesAt: ts('closes_at').notNull(),
    allowOffline: boolean('allow_offline').notNull().default(false),
    /** Marks deducted for each wrong answer (0 = no negative marking). */
    negativeMarks: real('negative_marks').notNull().default(0),
    /** Show the score and answer review as soon as the student submits. */
    instantResults: boolean('instant_results').notNull().default(true),
    publishedAt: ts('published_at'),
    resultsReleasedAt: ts('results_released_at'),
    createdBy: uuid('created_by').references(() => staffUsers.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('tests_class_idx').on(t.classId), index('tests_window_idx').on(t.opensAt, t.closesAt)],
);

export const testQuestions = pgTable(
  'test_questions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    testId: uuid('test_id')
      .notNull()
      .references(() => tests.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    text: text('text').notNull(),
    options: jsonb('options').$type<string[]>().notNull(),
    correctIndex: integer('correct_index').notNull(),
    marks: real('marks').notNull().default(1),
    topic: text('topic'),
    explanation: text('explanation'),
    /** The GenPrep question this was copied from, if any. */
    bankQuestionId: text('bank_question_id'),
    /** Subject of the question in an exam test (Physics, Chemistry…). */
    subject: text('subject'),
  },
  (t) => [uniqueIndex('test_questions_position_key').on(t.testId, t.position)],
);

export type AnswerMap = Record<string, number | null>;
export type TestAudience = 'PUC_1' | 'PUC_2' | 'BOTH';

export const testAttempts = pgTable(
  'test_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    testId: uuid('test_id')
      .notNull()
      .references(() => tests.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    mode: attemptMode('mode').notNull(),
    startedAt: ts('started_at').notNull(),
    submittedAt: ts('submitted_at'),
    /** Client clock readings, kept for review only (never trusted for grading decisions). */
    clientStartedAt: ts('client_started_at'),
    clientSubmittedAt: ts('client_submitted_at'),
    elapsedSec: integer('elapsed_sec'),
    deviceSerial: text('device_serial'),
    answers: jsonb('answers').$type<AnswerMap>(),
    score: real('score'),
    maxScore: real('max_score'),
    correctCount: integer('correct_count'),
    reviewStatus: reviewStatus('review_status').notNull().default('NONE'),
    reviewReason: text('review_reason'),
    reviewedBy: uuid('reviewed_by').references(() => staffUsers.id, { onDelete: 'set null' }),
    reviewedAt: ts('reviewed_at'),
    /** Live monitoring, reported by the tablet every few seconds while the test is open. */
    currentQuestion: integer('current_question'),
    skippedCount: integer('skipped_count'),
    batteryPercent: integer('battery_percent'),
    charging: boolean('charging'),
    lastSeenAt: ts('last_seen_at'),
    /** Extra seconds added by staff ("revive"), on top of the normal deadline. */
    extraSec: integer('extra_sec').notNull().default(0),
    revivedAt: ts('revived_at'),
    /** Set when staff submitted the attempt for the student. */
    forcedBy: uuid('forced_by').references(() => staffUsers.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('test_attempts_test_student_key').on(t.testId, t.studentId), index('test_attempts_student_idx').on(t.studentId)],
);

/** One roll call: a class period for a section, or a hostel roll call. */
export const attendanceSessions = pgTable(
  'attendance_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: attendanceKind('kind').notNull(),
    date: date('date').notNull(),
    label: text('label').notNull(),
    sectionId: uuid('section_id').references(() => sections.id, { onDelete: 'cascade' }),
    hostelId: uuid('hostel_id').references(() => hostels.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id').references(() => subjects.id, { onDelete: 'set null' }),
    takenBy: uuid('taken_by').references(() => staffUsers.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('attendance_sessions_key').on(
      t.date,
      t.label,
      sql`coalesce(${t.sectionId}::text, '')`,
      sql`coalesce(${t.hostelId}::text, '')`,
    ),
    index('attendance_sessions_date_idx').on(t.date),
  ],
);

export const attendanceRecords = pgTable(
  'attendance_records',
  {
    sessionId: uuid('session_id')
      .notNull()
      .references(() => attendanceSessions.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    status: attendanceStatus('status').notNull(),
    note: text('note'),
    updatedBy: uuid('updated_by').references(() => staffUsers.id, { onDelete: 'set null' }),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.studentId] }), index('attendance_records_student_idx').on(t.studentId)],
);

export const notices = pgTable(
  'notices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    category: noticeCategory('category').notNull().default('GENERAL'),
    audienceType: audienceType('audience_type').notNull().default('ALL'),
    /** The class, section or hostel the notice is for (null when audienceType is ALL). */
    audienceId: uuid('audience_id'),
    postedBy: uuid('posted_by').references(() => staffUsers.id, { onDelete: 'set null' }),
    postedByLabel: text('posted_by_label').notNull(),
    publishedAt: ts('published_at').notNull().defaultNow(),
    expiresAt: ts('expires_at'),
    createdAt: createdAt(),
  },
  (t) => [index('notices_published_idx').on(t.publishedAt), index('notices_audience_idx').on(t.audienceType, t.audienceId)],
);

export const noticeReads = pgTable(
  'notice_reads',
  {
    noticeId: uuid('notice_id')
      .notNull()
      .references(() => notices.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    readAt: ts('read_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.noticeId, t.studentId] })],
);

export const liveClasses = pgTable(
  'live_classes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    /** Optional: only one section of the class. */
    sectionId: uuid('section_id').references(() => sections.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'restrict' }),
    teacherId: uuid('teacher_id').references(() => staffUsers.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at').notNull(),
    /** Meeting link on the college's chosen platform (Jitsi, Google Meet, Zoom …). */
    joinUrl: text('join_url').notNull(),
    recordingMaterialId: uuid('recording_material_id').references(() => materials.id, { onDelete: 'set null' }),
    cancelledAt: ts('cancelled_at'),
    createdBy: uuid('created_by').references(() => staffUsers.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('live_classes_class_time_idx').on(t.classId, t.startsAt)],
);

export const liveQuestions = pgTable(
  'live_questions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    liveClassId: uuid('live_class_id')
      .notNull()
      .references(() => liveClasses.id, { onDelete: 'cascade' }),
    authorType: principalType('author_type').notNull(),
    authorId: uuid('author_id'),
    authorName: text('author_name').notNull(),
    body: text('body').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('live_questions_class_idx').on(t.liveClassId, t.createdAt)],
);

// ---- Relations (for relational queries) ----

export const academicYearsRelations = relations(academicYears, ({ many }) => ({ classes: many(classes) }));

export const classesRelations = relations(classes, ({ one, many }) => ({
  academicYear: one(academicYears, { fields: [classes.academicYearId], references: [academicYears.id] }),
  sections: many(sections),
  classSubjects: many(classSubjects),
}));

export const sectionsRelations = relations(sections, ({ one, many }) => ({
  classGroup: one(classes, { fields: [sections.classId], references: [classes.id] }),
  students: many(students),
}));

export const subjectsRelations = relations(subjects, ({ many }) => ({ classSubjects: many(classSubjects) }));

export const classSubjectsRelations = relations(classSubjects, ({ one }) => ({
  classGroup: one(classes, { fields: [classSubjects.classId], references: [classes.id] }),
  subject: one(subjects, { fields: [classSubjects.subjectId], references: [subjects.id] }),
}));

export const hostelsRelations = relations(hostels, ({ one, many }) => ({
  warden: one(staffUsers, { fields: [hostels.wardenId], references: [staffUsers.id] }),
  students: many(students),
}));

export const studentsRelations = relations(students, ({ one }) => ({
  section: one(sections, { fields: [students.sectionId], references: [sections.id] }),
  hostel: one(hostels, { fields: [students.hostelId], references: [hostels.id] }),
  tablet: one(tablets, { fields: [students.id], references: [tablets.studentId] }),
}));

export const tabletsRelations = relations(tablets, ({ one }) => ({
  student: one(students, { fields: [tablets.studentId], references: [students.id] }),
}));

// ============================================================== practice (GenPrep style)

export const prepMode = pgEnum('prep_mode', ['practice', 'mock', 'wrong', 'bookmark']);
export const prepStatus = pgEnum('prep_status', ['in_progress', 'submitted', 'auto_submitted']);

/** One question in a practice attempt, with the student's answer as last saved. */
export interface PrepItem {
  questionId: string;
  subjectId: string;
  chapterId: string;
  topicId: string;
  selected: string[];
  numerical?: number;
  marked: boolean;
  timeSec: number;
  /** Filled in when the attempt is scored. */
  correctOptionIds?: string[];
  isCorrect?: boolean | null;
  marksAwarded?: number;
}

export interface PrepResult {
  score: number;
  maxScore: number;
  percentage: number;
  accuracy: number;
  correct: number;
  incorrect: number;
  unanswered: number;
  timeTakenSec: number;
  subjects: { subjectId: string; name: string; score: number; correct: number; incorrect: number; unanswered: number }[];
  chapters: { chapterId: string; name: string; correct: number; attempted: number }[];
}

/** A practice session, mock test or revision set taken on a tablet. Questions come from the bank. */
export const prepAttempts = pgTable(
  'prep_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    examId: text('exam_id').notNull(),
    examCode: text('exam_code').notNull(),
    mode: prepMode('mode').notNull(),
    title: text('title').notNull(),
    filters: jsonb('filters').$type<Record<string, unknown>>().notNull().default({}),
    status: prepStatus('status').notNull().default('in_progress'),
    marking: jsonb('marking').$type<{ correct: number; incorrect: number; unanswered: number }>().notNull(),
    items: jsonb('items').$type<PrepItem[]>().notNull(),
    result: jsonb('result').$type<PrepResult>(),
    startedAt: ts('started_at').notNull().defaultNow(),
    expiresAt: ts('expires_at'),
    submittedAt: ts('submitted_at'),
  },
  (t) => [index('prep_attempts_student_idx').on(t.studentId, t.startedAt), index('prep_attempts_exam_idx').on(t.studentId, t.examId, t.status)],
);

/** Every scored answer, one row each: drives analytics and "revise wrong answers". */
export const prepAnswers = pgTable(
  'prep_answers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    attemptId: uuid('attempt_id')
      .notNull()
      .references(() => prepAttempts.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    examId: text('exam_id').notNull(),
    questionId: text('question_id').notNull(),
    subjectId: text('subject_id').notNull(),
    chapterId: text('chapter_id').notNull(),
    topicId: text('topic_id').notNull(),
    isCorrect: boolean('is_correct'),
    timeSec: integer('time_sec').notNull().default(0),
    answeredAt: ts('answered_at').notNull().defaultNow(),
  },
  (t) => [index('prep_answers_student_idx').on(t.studentId, t.examId, t.answeredAt), index('prep_answers_question_idx').on(t.studentId, t.questionId)],
);

export const prepBookmarks = pgTable(
  'prep_bookmarks',
  {
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    questionId: text('question_id').notNull(),
    examId: text('exam_id').notNull(),
    subjectId: text('subject_id').notNull(),
    chapterId: text('chapter_id').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.studentId, t.questionId] }), index('prep_bookmarks_exam_idx').on(t.studentId, t.examId)],
);
