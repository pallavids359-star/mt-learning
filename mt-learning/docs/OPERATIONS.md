# Operations guide

## Production setup (single server)

1. Provision a Linux server with Docker, reachable from the hostel network. Point two DNS names at it, for example `admin.college.edu` and `api.college.edu`.
2. Copy `.env.example` to `.env` and set:
   - `POSTGRES_PASSWORD`: a long random value.
   - `JWT_ACCESS_SECRET`: the output of `openssl rand -base64 48`. Changing it signs everyone out.
   - `CORS_ORIGINS`: the admin portal's HTTPS origin.
   - Optional: `COLLEGE_TIMEZONE` (default `Asia/Kolkata`, used for "today", attendance and timetables), `MAX_UPLOAD_MB` (default 300, the largest study material), `LIVE_ALLOWED_HOSTS` (meeting platforms teachers may link to; default Jitsi, Google Meet, Zoom and Teams) and `TEST_GRACE_MINUTES` (default 2, how late an offline test can arrive before it needs a teacher's review).
   - Student photos are kept in the `api-storage` volume. Include it in backups.
   - `GENPREP_DATABASE_URL`: the question bank (GenPrep's Supabase project), read through a role that can only read the `questions` table:
     ```sql
     create role mt_reader with login password 'a-long-random-password';
     grant usage on schema public to mt_reader;
     grant select on public.questions to mt_reader;
     create policy mt_reader_read on public.questions for select to mt_reader using (true);
     ```
     Use the project's Session pooler address with the user `mt_reader.<project-ref>`. Leave it empty to use the built-in sample questions.
   - If your HTTPS proxy limits request size, raise it to at least `MAX_UPLOAD_MB` for the API (Caddy has no limit by default; nginx needs `client_max_body_size 300m;`).
3. Run `docker compose up -d --build`. Database migrations run automatically when the API starts.
4. Create the first Super Administrator:
   ```bash
   docker compose exec -e SEED_ADMIN_EMAIL=you@college.edu -e SEED_ADMIN_PASSWORD='a-long-password' api node dist/db/seed.js
   ```
5. Put HTTPS in front of ports 8080 (portal) and 3000 (API), for example with Caddy:
   ```
   admin.college.edu { reverse_proxy localhost:8080 }
   api.college.edu   { reverse_proxy localhost:3000 }
   ```
   Do not expose PostgreSQL to the network.
6. Build the tablet app against the API URL:
   ```bash
   flutter build apk --release --dart-define=API_BASE_URL=https://api.college.edu
   ```
   Before wide rollout, create an upload keystore and configure release signing (see the Flutter docs on Android release signing). The CI build uses debug signing and is suitable for the pilot only.

## Using Supabase (hosted PostgreSQL) instead of the bundled database

1. Create a project at supabase.com. Choose a region near the college (Mumbai: `ap-south-1`) and keep the database password.
2. In the project, choose **Connect** and copy the **Session pooler** connection string (it works on every network; the "direct" one needs IPv6). Put your password in it and set it as `DATABASE_URL`.
3. The API turns on an encrypted connection automatically. For production, download the CA certificate from Supabase (*Database settings → SSL*), and set `DATABASE_SSL=verify` and `DATABASE_CA_FILE=/path/to/prod-ca.crt`.
4. Migrations lock every table against Supabase's automatic Data API (Row Level Security with no policies, and no rights for `anon`/`authenticated`). Only the API server can read student data. You can also switch the Data API off in the project settings.
5. With Docker, remove the `db` service, then set `DATABASE_URL` for the `api` service.
6. Backups: use Supabase's daily backups, and still keep your own `pg_dump` copies (see below).

## First-day onboarding

1. **Academic setup.** In *Classes & sections*, add the academic year and mark it current. Add subjects, then add each class with its sections and subjects. Add hostels and assign wardens after creating their staff accounts.
2. **Staff.** In *Staff accounts*, add each staff member with the right role. Give each person their temporary password privately; they choose their own at first sign-in.
3. **Students.** Use *Students → Import from CSV*: download the template, fill it, choose *Check file*, fix the listed rows, then import. Download the sign-in slips immediately, because passwords are shown only once. Print and hand them out, then delete the file.
4. **Tablets.** In *Tablets*, enrol each tablet by its serial number and assign it to a student. On each tablet, install the app; the first screen asks the device administrator to enter that tablet's serial number.
5. **Teaching.** For each class, open *Classes & sections → Teachers* and assign a teacher to each subject, then fill in each section's *Timetable* and the college *Holidays*. Teachers see only the classes they are assigned to.
6. When every student has their own tablet, set `ENFORCE_TABLET_BINDING=true` and restart the API. Students can then sign in only on their assigned tablet.

## Everyday tasks

| Situation | What to do |
|---|---|
| Student forgot password or PIN | Open the student and choose *Reset password*. This also unlocks a locked account and clears the PIN. |
| Student left the college | *Change status → Deactivated*. Records are kept for reports. |
| Tablet lost or stolen | In *Tablets*, set the status to *Lost*. The student is signed out at once. Assign a replacement from stock. |
| Tablet swap | *Unassign* the old tablet, then *Assign* the new one. On the new tablet, enter its serial in the setup screen. |
| Late offline test submissions | *Tests → Reviews* lists answers that arrived after the test closed. Accept them to count the score, or reject them with a note. |
| Practice shows "Sample questions" | The API is not connected to the question bank. Set `GENPREP_DATABASE_URL` (read-only role) and restart the API; the API log warns "using the built-in sample question bank" while it is not connected. |
| Test answers released too early | They can't be. Students see correct answers only after the test has closed. *Release results* only controls whether scores are shown before then. |
| Who changed what | Use the *Audit log*, filtered by record type or date. Each student page shows that student's history. |

## Backups

- **Database:** run a nightly `pg_dump`, keep at least 30 days, and store a copy off the server:
  ```bash
  docker compose exec -T db pg_dump -U mt -Fc mt_tablet > backup-$(date +%F).dump
  ```
  Test a restore every term: `pg_restore -d <empty database> backup.dump`.
- **Photos:** back up the `api-storage` Docker volume with the same schedule.

## Monitoring

- `GET /health/live` shows whether the process is up. `GET /health/ready` shows whether the database is reachable. Use them in your uptime monitor and load balancer.
- On the admin overview, watch *assigned tablets not seen in 7 days*. It usually means a tablet is off, broken or not connecting to the hostel Wi-Fi.

## Security notes

- Passwords and PINs are hashed with argon2id. Refresh tokens are stored only as SHA-256 hashes, rotated on every use, and reuse revokes the whole session.
- Access tokens last 15 minutes. Suspending an account, resetting credentials, changing a role, or unassigning, losing or retiring a tablet revokes the affected sessions immediately.
- Sign-in rate limits are kept per account, so many students behind one hostel Wi-Fi address are not blocked together. Accounts lock after repeated failures.
- On tablets, the session and cached data are stored in Android Keystore-backed encrypted storage, cloud backup of app data is disabled, and signing out removes cached data.
- Students are minors. Under India's Digital Personal Data Protection Act, the college should collect verifiable parental consent before enrolment and decide on retention periods. The audit log records every access to student records that changes them.
- Before go-live: switch `ENABLE_SWAGGER` off, serve everything over HTTPS only, restrict SSH, and keep the server patched.
