ALTER TABLE "tests" ALTER COLUMN "class_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tests" ALTER COLUMN "subject_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "test_questions" ADD COLUMN "subject" text;--> statement-breakpoint
ALTER TABLE "tests" ADD COLUMN "audience" text;--> statement-breakpoint
ALTER TABLE "tests" ADD COLUMN "exam_code" text;--> statement-breakpoint
ALTER TABLE "tests" ADD COLUMN "subject_names" jsonb;--> statement-breakpoint
ALTER TABLE "tests" ADD CONSTRAINT "tests_target_check" CHECK (("class_id" IS NOT NULL AND "subject_id" IS NOT NULL) OR ("audience" IN ('PUC_1', 'PUC_2', 'BOTH') AND "exam_code" IS NOT NULL));
