CREATE TYPE "public"."attempt_mode" AS ENUM('ONLINE', 'OFFLINE');--> statement-breakpoint
CREATE TYPE "public"."attendance_kind" AS ENUM('CLASS', 'HOSTEL');--> statement-breakpoint
CREATE TYPE "public"."attendance_status" AS ENUM('PRESENT', 'ABSENT', 'LEAVE');--> statement-breakpoint
CREATE TYPE "public"."audience_type" AS ENUM('ALL', 'CLASS', 'SECTION', 'HOSTEL');--> statement-breakpoint
CREATE TYPE "public"."material_kind" AS ENUM('PDF', 'VIDEO', 'SLIDES', 'LINK');--> statement-breakpoint
CREATE TYPE "public"."notice_category" AS ENUM('GENERAL', 'EXAM', 'HOSTEL', 'HOLIDAY', 'EVENT');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('NONE', 'PENDING', 'ACCEPTED', 'REJECTED');--> statement-breakpoint
CREATE TABLE "attendance_records" (
	"session_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"status" "attendance_status" NOT NULL,
	"note" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_records_session_id_student_id_pk" PRIMARY KEY("session_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "attendance_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "attendance_kind" NOT NULL,
	"date" date NOT NULL,
	"label" text NOT NULL,
	"section_id" uuid,
	"hostel_id" uuid,
	"subject_id" uuid,
	"taken_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "live_classes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"class_id" uuid NOT NULL,
	"section_id" uuid,
	"subject_id" uuid NOT NULL,
	"teacher_id" uuid,
	"title" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"join_url" text NOT NULL,
	"recording_material_id" uuid,
	"cancelled_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "live_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"live_class_id" uuid NOT NULL,
	"author_type" "principal_type" NOT NULL,
	"author_id" uuid,
	"author_name" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_progress" (
	"student_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"opened_at" timestamp with time zone,
	"downloaded_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "material_progress_student_id_material_id_pk" PRIMARY KEY("student_id","material_id")
);
--> statement-breakpoint
CREATE TABLE "materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"class_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"chapter" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"kind" "material_kind" NOT NULL,
	"file_key" text,
	"file_name" text,
	"mime_type" text,
	"size_bytes" integer,
	"duration_min" integer,
	"external_url" text,
	"allow_offline" boolean DEFAULT true NOT NULL,
	"published_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notice_reads" (
	"notice_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notice_reads_notice_id_student_id_pk" PRIMARY KEY("notice_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"category" "notice_category" DEFAULT 'GENERAL' NOT NULL,
	"audience_type" "audience_type" DEFAULT 'ALL' NOT NULL,
	"audience_id" uuid,
	"posted_by" uuid,
	"posted_by_label" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teaching_assignments" (
	"class_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"teacher_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teaching_assignments_class_id_subject_id_teacher_id_pk" PRIMARY KEY("class_id","subject_id","teacher_id")
);
--> statement-breakpoint
CREATE TABLE "test_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"test_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"mode" "attempt_mode" NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"submitted_at" timestamp with time zone,
	"client_started_at" timestamp with time zone,
	"client_submitted_at" timestamp with time zone,
	"elapsed_sec" integer,
	"device_serial" text,
	"answers" jsonb,
	"score" real,
	"max_score" real,
	"correct_count" integer,
	"review_status" "review_status" DEFAULT 'NONE' NOT NULL,
	"review_reason" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"test_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"text" text NOT NULL,
	"options" jsonb NOT NULL,
	"correct_index" integer NOT NULL,
	"marks" real DEFAULT 1 NOT NULL,
	"topic" text,
	"explanation" text
);
--> statement-breakpoint
CREATE TABLE "tests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"class_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"title" text NOT NULL,
	"instructions" text,
	"duration_min" integer NOT NULL,
	"opens_at" timestamp with time zone NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	"allow_offline" boolean DEFAULT false NOT NULL,
	"negative_marks" real DEFAULT 0 NOT NULL,
	"instant_results" boolean DEFAULT true NOT NULL,
	"published_at" timestamp with time zone,
	"results_released_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timetable_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"section_id" uuid NOT NULL,
	"day_of_week" integer NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"teacher_id" uuid,
	"topic" text,
	"room" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_session_id_attendance_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."attendance_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_updated_by_staff_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_hostel_id_hostels_id_fk" FOREIGN KEY ("hostel_id") REFERENCES "public"."hostels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_taken_by_staff_users_id_fk" FOREIGN KEY ("taken_by") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_classes" ADD CONSTRAINT "live_classes_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_classes" ADD CONSTRAINT "live_classes_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_classes" ADD CONSTRAINT "live_classes_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_classes" ADD CONSTRAINT "live_classes_teacher_id_staff_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_classes" ADD CONSTRAINT "live_classes_recording_material_id_materials_id_fk" FOREIGN KEY ("recording_material_id") REFERENCES "public"."materials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_classes" ADD CONSTRAINT "live_classes_created_by_staff_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_questions" ADD CONSTRAINT "live_questions_live_class_id_live_classes_id_fk" FOREIGN KEY ("live_class_id") REFERENCES "public"."live_classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_progress" ADD CONSTRAINT "material_progress_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_progress" ADD CONSTRAINT "material_progress_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_created_by_staff_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notice_reads" ADD CONSTRAINT "notice_reads_notice_id_notices_id_fk" FOREIGN KEY ("notice_id") REFERENCES "public"."notices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notice_reads" ADD CONSTRAINT "notice_reads_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_posted_by_staff_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teaching_assignments" ADD CONSTRAINT "teaching_assignments_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teaching_assignments" ADD CONSTRAINT "teaching_assignments_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teaching_assignments" ADD CONSTRAINT "teaching_assignments_teacher_id_staff_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."staff_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_attempts" ADD CONSTRAINT "test_attempts_test_id_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."tests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_attempts" ADD CONSTRAINT "test_attempts_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_attempts" ADD CONSTRAINT "test_attempts_reviewed_by_staff_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_questions" ADD CONSTRAINT "test_questions_test_id_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."tests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tests" ADD CONSTRAINT "tests_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tests" ADD CONSTRAINT "tests_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tests" ADD CONSTRAINT "tests_created_by_staff_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_teacher_id_staff_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_records_student_idx" ON "attendance_records" USING btree ("student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_sessions_key" ON "attendance_sessions" USING btree ("date","label",coalesce("section_id"::text, ''),coalesce("hostel_id"::text, ''));--> statement-breakpoint
CREATE INDEX "attendance_sessions_date_idx" ON "attendance_sessions" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "holidays_date_key" ON "holidays" USING btree ("date");--> statement-breakpoint
CREATE INDEX "live_classes_class_time_idx" ON "live_classes" USING btree ("class_id","starts_at");--> statement-breakpoint
CREATE INDEX "live_questions_class_idx" ON "live_questions" USING btree ("live_class_id","created_at");--> statement-breakpoint
CREATE INDEX "material_progress_material_idx" ON "material_progress" USING btree ("material_id");--> statement-breakpoint
CREATE INDEX "materials_class_subject_idx" ON "materials" USING btree ("class_id","subject_id");--> statement-breakpoint
CREATE INDEX "notices_published_idx" ON "notices" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "notices_audience_idx" ON "notices" USING btree ("audience_type","audience_id");--> statement-breakpoint
CREATE INDEX "teaching_teacher_idx" ON "teaching_assignments" USING btree ("teacher_id");--> statement-breakpoint
CREATE UNIQUE INDEX "test_attempts_test_student_key" ON "test_attempts" USING btree ("test_id","student_id");--> statement-breakpoint
CREATE INDEX "test_attempts_student_idx" ON "test_attempts" USING btree ("student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "test_questions_position_key" ON "test_questions" USING btree ("test_id","position");--> statement-breakpoint
CREATE INDEX "tests_class_idx" ON "tests" USING btree ("class_id");--> statement-breakpoint
CREATE INDEX "tests_window_idx" ON "tests" USING btree ("opens_at","closes_at");--> statement-breakpoint
CREATE UNIQUE INDEX "timetable_section_day_start_key" ON "timetable_slots" USING btree ("section_id","day_of_week","start_time");