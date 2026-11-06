# Manchester Technologies — PU College Tablet Platform

A controlled digital learning environment for PU college hostel students on college-issued Android tablets, with a web portal for college staff.

| Part | Folder | Stack |
|---|---|---|
| API | `backend/` | NestJS 11, PostgreSQL 16, Drizzle ORM, JWT + rotating refresh tokens, argon2id |
| Admin portal | `admin/` | React 19, Vite, TanStack Query |
| Student tablet app | `student_app/` | Flutter (Android), encrypted on-device storage |

## What it does

**Tablet app (students).** Two jobs:

1. **Practice, GenPrep style.** Questions come live from GenPrep's question bank (about 67,000 NEET, JEE and KCET questions, read-only).
   - **Practice:** pick chapters (and topics), difficulty and 10 to 60 questions. Untimed; answers and explanations after submitting.
   - **Mock tests:** full papers in the real pattern (NEET 45/45/90 in 3 h, JEE 25×3 in 3 h, KCET 60×3 in 4 h, PCM or PCB), timed, with exam marking. Leaving the app 3 times submits the paper.
   - **Revise:** retry questions answered wrong, practise saved (bookmarked) questions.
   - **Analytics:** accuracy, streak, last 30 days, subjects, weakest chapters, mock score trend and history, plus the marks from college live tests.
2. **Live tests.** Tests the college sets, with a countdown from the server clock, autosave, offline papers and a review once the test closes.

Attendance is kept in the college's **Bridge** app; the profile page has a link to it (`BRIDGE_URL`).

**Live exam monitor.** While a live test is open, the portal shows every student in the class, refreshed every 5 seconds: tablet, battery, active or inactive, the question on screen, attended / left / skipped, time left, submission and last seen, with totals at the top. For a student who got stuck, staff can **revive** the test (continue from the same question with the saved answers and extra time, even after the test closed, on any tablet), **force submit** the saved answers, or give a **new start**. Every action is in the audit log.

**Live tests by exam.** A live test is set for Class 11, Class 12 or both, and for NEET, JEE or KCET. The exam picks the subjects (NEET: Physics, Chemistry, Biology; JEE: Physics, Chemistry, Mathematics; KCET: all four), the usual marking and time; questions are added subject by subject from the question bank.

**Admin portal (staff).** Students, Live tests (questions typed in or picked from the GenPrep bank, with a maths preview), Results & marks (CSV download for Bridge), Tablets, Staff and the Audit log.

**Where data lives.** MT Learning's own PostgreSQL (Supabase) keeps students, tablets, live tests, practice attempts and marks. GenPrep's Supabase `questions` table is only read, through a read-only role. Without `GENPREP_DATABASE_URL` the API uses a small built-in sample bank so everything can still be tried.

**Offline test integrity.** An offline paper is signed by the server and tied to one student and one test. Answers record the tablet's start/submit times and elapsed time. A submission that arrives after the test closes (plus `TEST_GRACE_MINUTES`) is held as *pending* until a teacher accepts or rejects it, rather than being silently counted or dropped.

**Lost tablets.** Marking a tablet lost makes it sign out and wipe its local data at the next heartbeat.

Still to come:

| Phase | Scope |
|---|---|
| 4. Device control | Android Enterprise / MDM enrolment, kiosk mode, app allow-list, remote lock, app updates; serial number via managed configuration |
| Bridge link | Send live-test marks to the Bridge app automatically (today: CSV download) |
| 5. Advanced and rollout | SMS/parent notifications, load and security testing, pilot |

## Run it locally

Requirements: Node.js 22 or newer, PostgreSQL 16 or newer (local, or a hosted one such as Supabase; see docs/OPERATIONS.md) and Flutter (stable) for the tablet app. The API reads `backend/.env` by itself.

```bash
# 1. Database
createuser -P mt            # password: mt
createdb -O mt mt_tablet

# 2. API
cd backend
cp .env.example .env        # set SEED_ADMIN_PASSWORD; SEED_DEMO=true adds sample data
npm ci
npm run db:migrate:dev
npm run seed
npm run start:dev           # http://localhost:3000, API docs at /api/docs

# 3. Admin portal (new terminal)
cd admin
npm ci
npm run dev                 # http://localhost:5173 (proxies /api to the API)

# 4. Student app (new terminal, with an emulator or tablet connected)
cd student_app
./tool/setup_android.sh     # first time only: generates android/ (commit it afterwards)
flutter pub get
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000
```

Sign in to the portal with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`; you will be asked to choose a new password. With `SEED_DEMO=true`, demo students `MT26S0001`–`MT26S0020` use the password `Student@123`. Demo tablets are named `DEMO-TAB-001` and so on; enter one on the tablet's first-run setup screen.

## Tests

```bash
cd backend
npm test                    # unit tests
npm run test:e2e            # end-to-end tests against a real database (wipes TEST_DATABASE_URL)
cd ../student_app && flutter test
```

GitHub Actions (`.github/workflows/ci.yml`) runs all of these on every push. It also checks that every schema change has a migration, builds the admin portal and builds a release APK (download it from the run's artifacts).

## Deploy

See [docs/OPERATIONS.md](docs/OPERATIONS.md) for production setup, the first-day onboarding flow, backups and the go-live checklist.

## Decisions still to confirm with the college

These come from the planning document and affect later phases: whether students use only college tablets, which exams may run fully offline, whether tablets stay locked to the app at all times, which meeting platform live classes use, the number of students and tablets at launch, and whether one or several colleges will be served. The platform is built for **one college**. Tablet binding is off by default and can be switched on with `ENFORCE_TABLET_BINDING=true`.
