/**
 * Idempotent seed.
 *  - Always: ensures a Super Administrator exists (SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD).
 *  - SEED_DEMO=true: adds a demo academic year, classes, subjects, a hostel, students and tablets.
 *    Never enable SEED_DEMO in production.
 */
import '../config/dotenv';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { hashSecret } from '../common/utils/secrets';
import { poolConfig } from './pg-config';
import * as schema from './schema';

const { academicYears, classes, classSubjects, hostels, sections, staffUsers, students, subjects, tablets } = schema;

async function main() {
  const url = process.env.DATABASE_URL;
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!url) throw new Error('DATABASE_URL is required');
  if (!email || !password) throw new Error('SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD are required');
  if (password.length < 12) throw new Error('SEED_ADMIN_PASSWORD must be at least 12 characters');

  const pool = new Pool(poolConfig(url, 2));
  const db = drizzle(pool, { schema });
  try {
    const [existing] = await db.select().from(staffUsers).where(sql`lower(${staffUsers.email}) = ${email}`);
    if (existing) {
      console.log(`Super Administrator ${email} already exists`);
    } else {
      await db.insert(staffUsers).values({
        email,
        fullName: process.env.SEED_ADMIN_NAME ?? 'Super Administrator',
        role: 'SUPER_ADMIN',
        passwordHash: await hashSecret(password),
        mustChangePassword: true,
      });
      console.log(`Created Super Administrator ${email} (must change password at first sign-in)`);
    }

    if (process.env.SEED_DEMO === 'true') {
      if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed demo data in production');
      await seedDemo(db);
      await seedTeaching(db);
    }
  } finally {
    await pool.end();
  }
}

async function seedDemo(db: ReturnType<typeof drizzle<typeof schema>>) {
  const [hasYear] = await db.select().from(academicYears).where(eq(academicYears.name, '2026-27'));
  if (hasYear) {
    console.log('Demo data already present');
    return;
  }
  await db.transaction(async (tx) => {
    const [year] = await tx
      .insert(academicYears)
      .values({ name: '2026-27', startDate: '2026-06-01', endDate: '2027-03-31', isCurrent: true })
      .returning();
    const subjectRows = await tx
      .insert(subjects)
      .values([
        { code: 'ENG', name: 'English' },
        { code: 'KAN', name: 'Kannada' },
        { code: 'PHY', name: 'Physics' },
        { code: 'CHE', name: 'Chemistry' },
        { code: 'MAT', name: 'Mathematics' },
        { code: 'BIO', name: 'Biology' },
      ])
      .returning();
    const [hostel] = await tx.insert(hostels).values({ name: 'Boys Hostel A' }).returning();
    const demoHash = await hashSecret('Student@123');

    let n = 1;
    for (const [pucYear, label] of [
      ['PUC_1', '1st PUC'],
      ['PUC_2', '2nd PUC'],
    ] as const) {
      const [cls] = await tx
        .insert(classes)
        .values({ academicYearId: year.id, pucYear, stream: 'PCMB', name: `${label} Science (PCMB)` })
        .returning();
      await tx.insert(classSubjects).values(subjectRows.map((s) => ({ classId: cls.id, subjectId: s.id })));
      const secs = await tx
        .insert(sections)
        .values([
          { classId: cls.id, name: 'A' },
          { classId: cls.id, name: 'B' },
        ])
        .returning();
      for (const sec of secs) {
        for (let roll = 1; roll <= 5; roll++, n++) {
          const code = `MT26S${String(n).padStart(4, '0')}`;
          const [st] = await tx
            .insert(students)
            .values({
              studentCode: code,
              fullName: `Demo Student ${n}`,
              sectionId: sec.id,
              rollNumber: String(roll),
              hostelId: hostel.id,
              roomNumber: String(100 + n),
              passwordHash: demoHash,
              mustChangePassword: false,
            })
            .returning();
          if (n <= 8) {
            await tx.insert(tablets).values({
              serialNumber: `DEMO-TAB-${String(n).padStart(3, '0')}`,
              model: 'Demo Android Tablet',
              status: 'ASSIGNED',
              studentId: st.id,
              assignedAt: new Date(),
            });
          }
        }
      }
    }
    await tx.insert(tablets).values([
      { serialNumber: 'DEMO-TAB-101', model: 'Demo Android Tablet' },
      { serialNumber: 'DEMO-TAB-102', model: 'Demo Android Tablet' },
    ]);
  });
  console.log('Seeded demo data: 20 students (password Student@123), 10 tablets');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/** Phase 2 demo: teachers, timetable, materials, tests with attempts, attendance, notices, a live class. */
async function seedTeaching(db: ReturnType<typeof drizzle<typeof schema>>) {
  const T = schema;
  const [already] = await db.select().from(T.tests).limit(1);
  if (already) {
    console.log('Teaching demo data already present');
    return;
  }
  const { mkdir, writeFile } = await import('node:fs/promises');
  const path = await import('node:path');
  const storageDir = path.resolve(process.env.STORAGE_DIR ?? './storage');
  const tz = process.env.COLLEGE_TIMEZONE ?? 'Asia/Kolkata';
  const localDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);
  const day = 86_400_000;
  const now = Date.now();

  const subjectRows = await db.select().from(T.subjects);
  const S = Object.fromEntries(subjectRows.map((x) => [x.code, x.id]));
  const classRows = await db.select().from(T.classes);
  const secRows = await db.select().from(T.sections);
  const studentRows = await db.select().from(T.students);
  const [hostel] = await db.select().from(T.hostels);
  const [admin] = await db.select().from(T.staffUsers).where(eq(T.staffUsers.role, 'SUPER_ADMIN'));
  const demoHash = await hashSecret('Teacher@123');

  const teacherDefs = [
    ['physics.teacher@demo.college', 'Prakash Joshi', 'PHY'],
    ['chemistry.teacher@demo.college', 'Rekha Iyer', 'CHE'],
    ['maths.teacher@demo.college', 'Anil Kamath', 'MAT'],
    ['biology.teacher@demo.college', 'Shobha Rao', 'BIO'],
  ] as const;
  const teacherIds: Record<string, string> = {};
  for (const [email, fullName, code] of teacherDefs) {
    const [t] = await db.insert(T.staffUsers).values({ email, fullName, role: 'TEACHER', passwordHash: demoHash, mustChangePassword: false }).returning();
    teacherIds[code] = t.id;
    for (const c of classRows) await db.insert(T.teachingAssignments).values({ classId: c.id, subjectId: S[code], teacherId: t.id });
  }
  const [warden] = await db
    .insert(T.staffUsers)
    .values({ email: 'warden@demo.college', fullName: 'Lakshmi Nayak', role: 'HOSTEL_WARDEN', passwordHash: demoHash, mustChangePassword: false })
    .returning();
  if (hostel) await db.update(T.hostels).set({ wardenId: warden.id }).where(eq(T.hostels.id, hostel.id));

  // Timetable: four periods a day, Monday to Saturday.
  const plan = [
    ['08:30', '09:20', 'PHY'],
    ['10:15', '11:05', 'CHE'],
    ['14:00', '14:50', 'MAT'],
    ['18:30', '19:30', 'BIO'],
  ] as const;
  for (const sec of secRows) {
    for (let d = 1; d <= 6; d++) {
      for (const [a, b, code] of plan) {
        await db.insert(T.timetableSlots).values({ sectionId: sec.id, dayOfWeek: d, startTime: a, endTime: b, subjectId: S[code], teacherId: teacherIds[code] });
      }
    }
  }

  // Materials with a small placeholder PDF.
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
  const mats = [
    ['PHY', 'Electric Charges and Fields', 'Gauss’s law — class notes'],
    ['PHY', 'Electrostatic Potential', 'Equipotential surfaces — summary'],
    ['CHE', 'Solutions', 'Colligative properties — summary'],
    ['MAT', 'Matrices', 'Determinants practice set'],
    ['BIO', 'Human Reproduction', 'Gametogenesis diagrams'],
  ] as const;
  for (const c of classRows) {
    for (const [code, chapter, title] of mats) {
      const [m] = await db
        .insert(T.materials)
        .values({ classId: c.id, subjectId: S[code], chapter, title, kind: 'PDF', allowOffline: true, publishedAt: new Date(now - 3 * day), createdBy: teacherIds[code] })
        .returning();
      const key = `materials/${m.id}/demo.pdf`;
      await mkdir(path.join(storageDir, 'materials', m.id), { recursive: true });
      await writeFile(path.join(storageDir, key), pdf);
      await db.update(T.materials).set({ fileKey: key, fileName: `${title}.pdf`, mimeType: 'application/pdf', sizeBytes: pdf.length }).where(eq(T.materials.id, m.id));
    }
  }

  // Tests: one open now (offline allowed) and one closed with results.
  const paper = [
    { text: 'The SI unit of electric flux is', options: ['N C⁻¹', 'N m² C⁻¹', 'C m⁻²', 'V m⁻²'], correctIndex: 1, topic: 'Electric flux', explanation: 'Flux = E × A, so the unit is (N/C)(m²).' },
    { text: 'A charge q sits at the centre of a cube. The flux through one face is', options: ['q / ε₀', 'q / 4ε₀', 'q / 6ε₀', '6q / ε₀'], correctIndex: 2, topic: 'Gauss’s law', explanation: 'Total flux q/ε₀ is shared equally by six faces.' },
    { text: 'The electric field inside a uniformly charged thin spherical shell is', options: ['Uniform and non-zero', 'Zero', 'Proportional to 1/r²', 'Proportional to r'], correctIndex: 1, topic: 'Gauss’s law', explanation: 'A Gaussian surface inside encloses no charge.' },
    { text: 'When a glass rod is rubbed with silk, the rod', options: ['Gains electrons', 'Gains protons', 'Loses electrons', 'Loses protons'], correctIndex: 2, topic: 'Charging by friction', explanation: 'Electrons move from glass to silk.' },
    { text: 'Two charges +2 μC and +8 μC are 30 cm apart. The field is zero at', options: ['10 cm from +2 μC', '15 cm from +2 μC', '20 cm from +2 μC', 'Nowhere between them'], correctIndex: 0, topic: 'Superposition', explanation: '2/x² = 8/(30−x)² gives x = 10 cm.' },
  ];
  for (const c of classRows) {
    const classStudents = studentRows.filter((st) => secRows.find((x) => x.id === st.sectionId)?.classId === c.id);
    const [open] = await db
      .insert(T.tests)
      .values({ classId: c.id, subjectId: S.PHY, title: 'Electric Charges and Fields — Unit test', durationMin: 10, opensAt: new Date(now - day), closesAt: new Date(now + 2 * day), allowOffline: true, publishedAt: new Date(now - day), createdBy: teacherIds.PHY })
      .returning();
    const [closed] = await db
      .insert(T.tests)
      .values({ classId: c.id, subjectId: S.PHY, title: 'Electrostatics — Weekly test', durationMin: 15, opensAt: new Date(now - 8 * day), closesAt: new Date(now - 6 * day), publishedAt: new Date(now - 8 * day), resultsReleasedAt: new Date(now - 5 * day), createdBy: teacherIds.PHY })
      .returning();
    for (const t of [open, closed]) {
      await db.insert(T.testQuestions).values(paper.map((q, i) => ({ testId: t.id, position: i + 1, ...q })));
    }
    const qs = await db.select().from(T.testQuestions).where(eq(T.testQuestions.testId, closed.id));
    for (const [i, st] of classStudents.entries()) {
      const answers: Record<string, number | null> = {};
      let score = 0;
      qs.forEach((q, j) => {
        const right = (i + j) % 4 !== 0;
        answers[q.id] = right ? q.correctIndex : (q.correctIndex + 1) % q.options.length;
        if (right) score++;
      });
      const submitted = new Date(now - 7 * day + i * 60_000);
      await db.insert(T.testAttempts).values({ testId: closed.id, studentId: st.id, mode: 'ONLINE', startedAt: new Date(submitted.getTime() - (7 + (i % 6)) * 60_000), submittedAt: submitted, elapsedSec: (7 + (i % 6)) * 60, answers, score, maxScore: qs.length, correctCount: score });
    }
  }

  // Attendance: two weeks of period-1 and hostel roll calls.
  for (let back = 13; back >= 0; back--) {
    const date = localDate(new Date(now - back * day));
    if (new Date(`${date}T12:00:00Z`).getUTCDay() === 0) continue; // Sundays off
    for (const sec of secRows) {
      const [sess] = await db.insert(T.attendanceSessions).values({ kind: 'CLASS', date, label: 'Period 1', sectionId: sec.id, subjectId: S.PHY, takenBy: teacherIds.PHY }).returning();
      const list = studentRows.filter((st) => st.sectionId === sec.id);
      for (const [i, st] of list.entries()) {
        const status = (i * 7 + back) % 17 === 0 ? 'ABSENT' : (i + back) % 23 === 0 ? 'LEAVE' : 'PRESENT';
        await db.insert(T.attendanceRecords).values({ sessionId: sess.id, studentId: st.id, status, updatedBy: teacherIds.PHY });
      }
    }
    if (hostel) {
      const [h] = await db.insert(T.attendanceSessions).values({ kind: 'HOSTEL', date, label: 'Evening roll call', hostelId: hostel.id, takenBy: warden.id }).returning();
      for (const st of studentRows.filter((x) => x.hostelId === hostel.id)) {
        await db.insert(T.attendanceRecords).values({ sessionId: h.id, studentId: st.id, status: 'PRESENT', updatedBy: warden.id });
      }
    }
  }

  await db.insert(T.notices).values([
    { title: 'Mid-term examination timetable released', body: 'Mid-term exams for 2nd PUC begin on 18 November. The full timetable is in the Tests section. Hall tickets will be issued by the class teacher.', category: 'EXAM', audienceType: 'ALL', postedBy: admin?.id, postedByLabel: 'Examination Coordinator', publishedAt: new Date(now - 3 * 3_600_000) },
    { title: 'Study hours change from Monday', body: 'Evening study hours run from 6:30 pm to 9:30 pm in the hostel reading room. Tablets must be on charge at the racks by 10:00 pm.', category: 'HOSTEL', audienceType: hostel ? 'HOSTEL' : 'ALL', audienceId: hostel?.id ?? null, postedBy: warden.id, postedByLabel: 'Lakshmi Nayak · Hostel Warden', publishedAt: new Date(now - 26 * 3_600_000) },
  ]);

  for (const c of classRows) {
    await db.insert(T.liveClasses).values({ classId: c.id, subjectId: S.CHE, teacherId: teacherIds.CHE, title: 'Electrochemistry — EMF of a cell', startsAt: new Date(now - 10 * 60_000), endsAt: new Date(now + 50 * 60_000), joinUrl: `https://meet.jit.si/mt-demo-${c.id.slice(0, 8)}`, createdBy: teacherIds.CHE });
  }
  console.log('Seeded teaching demo data: 4 teachers + 1 warden (password Teacher@123), timetable, materials, tests, attendance, notices, live class');
}
