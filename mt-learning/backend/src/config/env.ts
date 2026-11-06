import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform((v) => v === 'true' || v === '1');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  STAFF_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(7),
  STUDENT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),

  /** Comma-separated list of allowed admin-portal origins. */
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  /** When true, a student may only sign in on the tablet assigned to them. */
  ENFORCE_TABLET_BINDING: bool,
  /** Trust X-Forwarded-For from the reverse proxy in front of the API. */
  TRUST_PROXY: bool,

  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().positive().default(15),
  ENABLE_SWAGGER: bool,
  /** Directory for uploaded files such as student photographs. */
  STORAGE_DIR: z.string().default('./storage'),
  /** Time zone used for "today", timetables and attendance dates. */
  COLLEGE_TIMEZONE: z.string().default('Asia/Kolkata'),
  /** Largest study-material upload, in megabytes. */
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(300),
  /** Minutes of grace after a test's time limit or closing time before a submission needs staff review. */
  /** Meeting platforms allowed for live-class links (host names, comma-separated). */
  LIVE_ALLOWED_HOSTS: z.string().default('meet.jit.si,meet.google.com,zoom.us,teams.microsoft.com'),
  TEST_GRACE_MINUTES: z.coerce.number().int().min(0).default(2),
  /** The question bank's Supabase/PostgreSQL address (GenPrep's project, read-only role). Preferred over GENPREP_MONGO_URI. */
  GENPREP_DATABASE_URL: z.string().optional().transform((v) => (v && v.trim() ? v.trim() : undefined)),
  /** Older: GenPrep's MongoDB (read-only). When neither is set, a small built-in sample question bank is used. */
  GENPREP_MONGO_URI: z.string().optional().transform((v) => (v && v.trim() ? v.trim() : undefined)),
  /** Database name inside that MongoDB; defaults to the one named in the URI. */
  GENPREP_DB_NAME: z.string().optional().transform((v) => (v && v.trim() ? v.trim() : undefined)),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test helper: clears the cached configuration. */
export function resetEnvCache(): void {
  cached = undefined;
}
