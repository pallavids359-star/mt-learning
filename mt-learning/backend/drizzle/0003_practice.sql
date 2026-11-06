CREATE TYPE "public"."prep_mode" AS ENUM('practice', 'mock', 'wrong', 'bookmark');--> statement-breakpoint
CREATE TYPE "public"."prep_status" AS ENUM('in_progress', 'submitted', 'auto_submitted');--> statement-breakpoint
CREATE TABLE "prep_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"exam_id" text NOT NULL,
	"question_id" text NOT NULL,
	"subject_id" text NOT NULL,
	"chapter_id" text NOT NULL,
	"topic_id" text NOT NULL,
	"is_correct" boolean,
	"time_sec" integer DEFAULT 0 NOT NULL,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prep_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"exam_id" text NOT NULL,
	"exam_code" text NOT NULL,
	"mode" "prep_mode" NOT NULL,
	"title" text NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "prep_status" DEFAULT 'in_progress' NOT NULL,
	"marking" jsonb NOT NULL,
	"items" jsonb NOT NULL,
	"result" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"submitted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "prep_bookmarks" (
	"student_id" uuid NOT NULL,
	"question_id" text NOT NULL,
	"exam_id" text NOT NULL,
	"subject_id" text NOT NULL,
	"chapter_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prep_bookmarks_student_id_question_id_pk" PRIMARY KEY("student_id","question_id")
);
--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "target_exam_id" text;--> statement-breakpoint
ALTER TABLE "test_questions" ADD COLUMN "bank_question_id" text;--> statement-breakpoint
ALTER TABLE "prep_answers" ADD CONSTRAINT "prep_answers_attempt_id_prep_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."prep_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prep_answers" ADD CONSTRAINT "prep_answers_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prep_attempts" ADD CONSTRAINT "prep_attempts_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prep_bookmarks" ADD CONSTRAINT "prep_bookmarks_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prep_answers_student_idx" ON "prep_answers" USING btree ("student_id","exam_id","answered_at");--> statement-breakpoint
CREATE INDEX "prep_answers_question_idx" ON "prep_answers" USING btree ("student_id","question_id");--> statement-breakpoint
CREATE INDEX "prep_attempts_student_idx" ON "prep_attempts" USING btree ("student_id","started_at");--> statement-breakpoint
CREATE INDEX "prep_attempts_exam_idx" ON "prep_attempts" USING btree ("student_id","exam_id","status");--> statement-breakpoint
CREATE INDEX "prep_bookmarks_exam_idx" ON "prep_bookmarks" USING btree ("student_id","exam_id");--> statement-breakpoint
-- Keep the new tables private to the API server, like every other table (see 0002).
ALTER TABLE "prep_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "prep_answers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "prep_bookmarks" ENABLE ROW LEVEL SECURITY;
