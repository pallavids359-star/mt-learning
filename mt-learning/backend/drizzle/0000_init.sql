CREATE TYPE "public"."account_status" AS ENUM('ACTIVE', 'SUSPENDED', 'DEACTIVATED');--> statement-breakpoint
CREATE TYPE "public"."gender" AS ENUM('MALE', 'FEMALE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."principal_type" AS ENUM('STAFF', 'STUDENT', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."puc_year" AS ENUM('PUC_1', 'PUC_2');--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('SUPER_ADMIN', 'COLLEGE_ADMIN', 'PRINCIPAL', 'TEACHER', 'EXAM_COORDINATOR', 'HOSTEL_WARDEN', 'DEVICE_ADMIN');--> statement-breakpoint
CREATE TYPE "public"."tablet_status" AS ENUM('IN_STOCK', 'ASSIGNED', 'UNDER_REPAIR', 'LOST', 'RETIRED');--> statement-breakpoint
CREATE TABLE "academic_years" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_type" "principal_type" NOT NULL,
	"actor_id" uuid,
	"actor_label" text,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"metadata" jsonb,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "class_subjects" (
	"class_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	CONSTRAINT "class_subjects_class_id_subject_id_pk" PRIMARY KEY("class_id","subject_id")
);
--> statement-breakpoint
CREATE TABLE "classes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"puc_year" "puc_year" NOT NULL,
	"stream" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hostels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"warden_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"class_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"principal" "principal_type" NOT NULL,
	"staff_id" uuid,
	"student_id" uuid,
	"token_hash" text NOT NULL,
	"family_id" uuid NOT NULL,
	"user_agent" text,
	"ip" text,
	"device_serial" text,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"phone" text,
	"role" "staff_role" NOT NULL,
	"status" "account_status" DEFAULT 'ACTIVE' NOT NULL,
	"password_hash" text NOT NULL,
	"must_change_password" boolean DEFAULT true NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "students" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_code" text NOT NULL,
	"full_name" text NOT NULL,
	"date_of_birth" date,
	"gender" "gender",
	"photo_url" text,
	"guardian_name" text,
	"guardian_phone" text,
	"section_id" uuid NOT NULL,
	"roll_number" text NOT NULL,
	"hostel_id" uuid,
	"room_number" text,
	"status" "account_status" DEFAULT 'ACTIVE' NOT NULL,
	"password_hash" text NOT NULL,
	"pin_hash" text,
	"must_change_password" boolean DEFAULT true NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subjects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tablets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"serial_number" text NOT NULL,
	"asset_tag" text,
	"model" text NOT NULL,
	"android_version" text,
	"app_version" text,
	"status" "tablet_status" DEFAULT 'IN_STOCK' NOT NULL,
	"student_id" uuid,
	"assigned_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "class_subjects" ADD CONSTRAINT "class_subjects_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_subjects" ADD CONSTRAINT "class_subjects_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hostels" ADD CONSTRAINT "hostels_warden_id_staff_users_id_fk" FOREIGN KEY ("warden_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_staff_id_staff_users_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_hostel_id_hostels_id_fk" FOREIGN KEY ("hostel_id") REFERENCES "public"."hostels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tablets" ADD CONSTRAINT "tablets_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "academic_years_name_key" ON "academic_years" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "academic_years_single_current" ON "academic_years" USING btree ("is_current") WHERE "academic_years"."is_current" = true;--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "classes_year_name_key" ON "classes" USING btree ("academic_year_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "hostels_name_key" ON "hostels" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "sections_class_name_key" ON "sections" USING btree ("class_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_family_idx" ON "sessions" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "sessions_staff_idx" ON "sessions" USING btree ("staff_id");--> statement-breakpoint
CREATE INDEX "sessions_student_idx" ON "sessions" USING btree ("student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_users_email_key" ON "staff_users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "staff_users_role_idx" ON "staff_users" USING btree ("role");--> statement-breakpoint
CREATE UNIQUE INDEX "students_code_key" ON "students" USING btree (upper("student_code"));--> statement-breakpoint
CREATE UNIQUE INDEX "students_section_roll_key" ON "students" USING btree ("section_id","roll_number");--> statement-breakpoint
CREATE INDEX "students_status_idx" ON "students" USING btree ("status");--> statement-breakpoint
CREATE INDEX "students_hostel_idx" ON "students" USING btree ("hostel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subjects_code_key" ON "subjects" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "tablets_serial_key" ON "tablets" USING btree (upper("serial_number"));--> statement-breakpoint
CREATE UNIQUE INDEX "tablets_asset_tag_key" ON "tablets" USING btree ("asset_tag");--> statement-breakpoint
CREATE UNIQUE INDEX "tablets_student_key" ON "tablets" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "tablets_status_idx" ON "tablets" USING btree ("status");