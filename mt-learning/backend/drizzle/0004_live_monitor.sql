ALTER TABLE "test_attempts" ADD COLUMN "current_question" integer;--> statement-breakpoint
ALTER TABLE "test_attempts" ADD COLUMN "skipped_count" integer;--> statement-breakpoint
ALTER TABLE "test_attempts" ADD COLUMN "battery_percent" integer;--> statement-breakpoint
ALTER TABLE "test_attempts" ADD COLUMN "charging" boolean;--> statement-breakpoint
ALTER TABLE "test_attempts" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "test_attempts" ADD COLUMN "extra_sec" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "test_attempts" ADD COLUMN "revived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "test_attempts" ADD COLUMN "forced_by" uuid;--> statement-breakpoint
ALTER TABLE "test_attempts" ADD CONSTRAINT "test_attempts_forced_by_staff_users_id_fk" FOREIGN KEY ("forced_by") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;