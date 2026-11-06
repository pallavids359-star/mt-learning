import { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import request from 'supertest';
import { bearer, setupApp, staffToken } from './helpers';

const API = '/api/v1';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n' + 'x'.repeat(2000));

let app: INestApplication;
let http: ReturnType<typeof request>;
let pool: Pool;
let admin: string;
let teacher: string;
let teacherId: string;
let warden: string;
let classId: string;
let otherClassId: string;
let sectionA: string;
let hostelId: string;
const subj: Record<string, string> = {};
const stu: Record<string, { id: string; token: string }> = {};

/** College-local date (Asia/Kolkata), as the API computes it. */
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

async function studentLogin(code: string, password: string) {
  const r = await http.post(`${API}/auth/student/login`).send({ studentCode: code, secret: password }).expect(200);
  if (r.body.mustChangePassword) {
    await http.post(`${API}/auth/change-password`).set(bearer(r.body.accessToken)).send({ currentPassword: password, newPassword: 'Student123' }).expect(204);
    const again = await http.post(`${API}/auth/student/login`).send({ studentCode: code, secret: 'Student123' }).expect(200);
    return again.body.accessToken as string;
  }
  return r.body.accessToken as string;
}

beforeAll(async () => {
  ({ app, http, pool } = await setupApp());
  admin = await staffToken(http);
  const A = bearer(admin);

  const year = await http.post(`${API}/academic-years`).set(A).send({ name: '2026-27', startDate: '2026-06-01', endDate: '2027-03-31', isCurrent: true }).expect(201);
  for (const code of ['PHY', 'CHE', 'MAT']) {
    subj[code] = (await http.post(`${API}/subjects`).set(A).send({ code, name: code }).expect(201)).body.id;
  }
  const c = await http
    .post(`${API}/classes`)
    .set(A)
    .send({ academicYearId: year.body.id, pucYear: 'PUC_2', stream: 'PCMB', name: '2nd PUC PCMB', sectionNames: ['A', 'B'], subjectIds: Object.values(subj) })
    .expect(201);
  classId = c.body.id;
  sectionA = c.body.sections.find((s: { name: string }) => s.name === 'A').id;
  otherClassId = (
    await http.post(`${API}/classes`).set(A).send({ academicYearId: year.body.id, pucYear: 'PUC_1', stream: 'PCMB', name: '1st PUC PCMB', sectionNames: ['A'], subjectIds: [subj.PHY] }).expect(201)
  ).body.id;

  const t = await http.post(`${API}/staff`).set(A).send({ email: 'physics@test.local', fullName: 'Prakash Joshi', role: 'TEACHER' }).expect(201);
  teacherId = t.body.staff.id;
  teacher = await staffToken(http, 'physics@test.local', t.body.temporaryPassword);
  const w = await http.post(`${API}/staff`).set(A).send({ email: 'warden@test.local', fullName: 'Girls Warden', role: 'HOSTEL_WARDEN' }).expect(201);
  warden = await staffToken(http, 'warden@test.local', w.body.temporaryPassword);
  hostelId = (await http.post(`${API}/hostels`).set(A).send({ name: 'Girls Hostel', wardenId: w.body.staff.id }).expect(201)).body.id;

  for (const [code, name, roll] of [
    ['MT26S0001', 'Ananya Rao', '1'],
    ['MT26S0002', 'Meghana Patil', '2'],
  ]) {
    const r = await http.post(`${API}/students`).set(A).send({ studentCode: code, fullName: name, sectionId: sectionA, rollNumber: roll, hostelId, roomNumber: 'G-1' }).expect(201);
    stu[code] = { id: r.body.student.id, token: await studentLogin(code, r.body.temporaryPassword) };
  }
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe('teaching assignments and timetable', () => {
  it('only accepts teachers for subjects the class studies', async () => {
    const A = bearer(admin);
    await http.put(`${API}/classes/${otherClassId}/teachers`).set(A).send({ assignments: [{ subjectId: subj.CHE, teacherId }] }).expect(400);
    const r = await http.put(`${API}/classes/${classId}/teachers`).set(A).send({ assignments: [{ subjectId: subj.PHY, teacherId }] }).expect(200);
    expect(r.body).toEqual([expect.objectContaining({ subjectId: subj.PHY, teacherName: 'Prakash Joshi' })]);
  });

  it('rejects overlapping periods and saves a valid week', async () => {
    const A = bearer(admin);
    await http
      .put(`${API}/sections/${sectionA}/timetable`)
      .set(A)
      .send({ slots: [{ dayOfWeek: 1, startTime: '08:30', endTime: '09:30', subjectId: subj.PHY }, { dayOfWeek: 1, startTime: '09:00', endTime: '10:00', subjectId: subj.CHE }] })
      .expect(400);
    const slots = [1, 2, 3, 4, 5, 6, 7].flatMap((d) => [
      { dayOfWeek: d, startTime: '00:00', endTime: '11:59', subjectId: subj.PHY, teacherId, topic: 'Electric charges' },
      { dayOfWeek: d, startTime: '12:00', endTime: '23:59', subjectId: subj.CHE },
    ]);
    const r = await http.put(`${API}/sections/${sectionA}/timetable`).set(A).send({ slots }).expect(200);
    expect(r.body).toHaveLength(14);
  });
});

describe('study materials', () => {
  let materialId: string;

  it('lets a teacher add material only for subjects they teach', async () => {
    await http.post(`${API}/materials`).set(bearer(teacher)).send({ classId, subjectId: subj.CHE, chapter: 'Solutions', title: 'Notes', kind: 'PDF' }).expect(403);
    const r = await http
      .post(`${API}/materials`)
      .set(bearer(teacher))
      .send({ classId, subjectId: subj.PHY, chapter: 'Electric Charges and Fields', title: 'Gauss’s law — class notes', kind: 'PDF' })
      .expect(201);
    materialId = r.body.id;
    expect(r.body.publishedAt).toBeNull();
  });

  it('checks the real file type and needs a file before publishing', async () => {
    const T = bearer(teacher);
    await http.post(`${API}/materials/${materialId}/publish`).set(T).expect(400);
    await http.post(`${API}/materials/${materialId}/file`).set(T).attach('file', Buffer.from('<html>not a pdf</html>'), 'notes.pdf').expect(400);
    const up = await http.post(`${API}/materials/${materialId}/file`).set(T).attach('file', PDF, 'gauss.pdf').expect(200);
    expect(up.body).toMatchObject({ hasFile: true, mimeType: 'application/pdf', fileName: 'gauss.pdf' });
  });

  it('hides drafts from students, then serves published files with range support', async () => {
    const S = bearer(stu.MT26S0001.token);
    expect((await http.get(`${API}/me/materials`).set(S).expect(200)).body).toHaveLength(0);
    await http.post(`${API}/materials/${materialId}/publish`).set(bearer(teacher)).expect(200);
    const list = await http.get(`${API}/me/materials`).set(S).expect(200);
    expect(list.body).toHaveLength(1);
    const full = await http.get(`${API}/me/materials/${materialId}/file`).set(S).expect(200);
    expect(full.headers['content-type']).toBe('application/pdf');
    const part = await http.get(`${API}/me/materials/${materialId}/file`).set(S).set('Range', 'bytes=0-3').expect(206);
    expect(part.body.toString()).toBe('%PDF');
  });

  it('records progress and shows completion to staff', async () => {
    const S = bearer(stu.MT26S0001.token);
    await http.post(`${API}/me/materials/${materialId}/progress`).set(S).send({ event: 'downloaded' }).expect(200);
    await http.post(`${API}/me/materials/${materialId}/progress`).set(S).send({ event: 'completed' }).expect(200);
    await http.post(`${API}/me/materials/${materialId}/progress`).set(S).send({ event: 'completed' }).expect(200);
    const staff = await http.get(`${API}/materials/${materialId}`).set(bearer(admin)).expect(200);
    expect(staff.body).toMatchObject({ completedCount: 1, openedCount: 1, studentCount: 2 });
  });
});

describe('tests and results', () => {
  let testId: string;
  let paper: { id: string }[];
  const qs = [
    { text: 'SI unit of electric flux?', options: ['N/C', 'N m²/C', 'C/m²'], correctIndex: 1, topic: 'Electric flux', explanation: 'Φ = E·A' },
    { text: 'Field inside a charged shell?', options: ['Zero', 'Uniform'], correctIndex: 0, topic: 'Gauss’s law' },
    { text: 'Rubbing glass with silk makes glass', options: ['Negative', 'Positive'], correctIndex: 1, topic: 'Charging' },
    { text: 'Flux through one face of a cube with q at centre', options: ['q/ε₀', 'q/6ε₀'], correctIndex: 1, topic: 'Gauss’s law' },
  ];

  it('creates, validates and publishes a test', async () => {
    const T = bearer(teacher);
    const opensAt = new Date(Date.now() - 60_000).toISOString();
    const closesAt = new Date(Date.now() + 3_600_000).toISOString();
    await http
      .post(`${API}/tests`)
      .set(T)
      .send({ classId, subjectId: subj.PHY, title: 'Bad', durationMin: 120, opensAt, closesAt: new Date(Date.now() + 60_000).toISOString() })
      .expect(400);
    await http
      .post(`${API}/tests`)
      .set(T)
      .send({ classId, subjectId: subj.PHY, title: 'Bad', durationMin: 10, opensAt, closesAt, questions: [{ text: 'Q', options: ['a', 'a'], correctIndex: 0 }] })
      .expect(400);
    const r = await http
      .post(`${API}/tests`)
      .set(T)
      .send({ classId, subjectId: subj.PHY, title: 'Electric Charges — Unit test', durationMin: 10, opensAt, closesAt, allowOffline: true, negativeMarks: 0.25, questions: qs })
      .expect(201);
    testId = r.body.id;
    expect(r.body.questions).toHaveLength(4);
    const S = bearer(stu.MT26S0001.token);
    expect((await http.get(`${API}/me/tests`).set(S).expect(200)).body).toHaveLength(0);
    await http.post(`${API}/tests/${testId}/publish`).set(T).expect(200);
    const list = await http.get(`${API}/me/tests`).set(S).expect(200);
    expect(list.body[0]).toMatchObject({ id: testId, state: 'open', questionCount: 4, attempt: null });
  });

  it('gives students the paper without answers', async () => {
    const r = await http.post(`${API}/me/tests/${testId}/start`).set(bearer(stu.MT26S0001.token)).send({}).expect(200);
    paper = r.body.paper.questions;
    expect(paper).toHaveLength(4);
    expect(JSON.stringify(r.body)).not.toContain('correctIndex');
    expect(JSON.stringify(r.body)).not.toContain('explanation');
    // Resuming returns the same attempt.
    const again = await http.post(`${API}/me/tests/${testId}/start`).set(bearer(stu.MT26S0001.token)).send({}).expect(200);
    expect(again.body.attemptId).toBe(r.body.attemptId);
  });

  it('blocks question changes once students have started', async () => {
    await http.put(`${API}/tests/${testId}/questions`).set(bearer(teacher)).send({ questions: qs }).expect(409);
  });

  it('grades an online submission with negative marking and handles retries', async () => {
    const S = bearer(stu.MT26S0001.token);
    // Right, right, wrong, skipped → 2 − 0.25 = 1.75 of 4
    const answers = { [paper[0].id]: 1, [paper[1].id]: 0, [paper[2].id]: 0, [paper[3].id]: null };
    const r = await http.post(`${API}/me/tests/${testId}/submit`).set(S).send({ mode: 'ONLINE', answers }).expect(200);
    expect(r.body).toMatchObject({ reviewStatus: 'NONE', result: { score: 1.75, maxScore: 4, correctCount: 2, percent: 43.8 } });
    await http.post(`${API}/me/tests/${testId}/submit`).set(S).send({ mode: 'ONLINE', answers }).expect(200);
    await http.post(`${API}/me/tests/${testId}/submit`).set(S).send({ mode: 'ONLINE', answers: { ...answers, [paper[3].id]: 1 } }).expect(409);
    // Answers are not revealed while the test is still open.
    await http.get(`${API}/me/tests/${testId}/review`).set(S).expect(403);
  });

  it('accepts an offline submission only with a valid package', async () => {
    const S = bearer(stu.MT26S0002.token);
    const pkg = await http.get(`${API}/me/tests/${testId}/package`).set(S).expect(200);
    expect(JSON.stringify(pkg.body.paper)).not.toContain('correctIndex');
    const answers = Object.fromEntries(pkg.body.paper.questions.map((q: { id: string }, i: number) => [q.id, qs[i].correctIndex]));
    await http.post(`${API}/me/tests/${testId}/submit`).set(S).send({ mode: 'OFFLINE', answers, packageToken: 'forged.token' }).expect(403);
    // A package issued to one student does not work for another.
    const other = await http.get(`${API}/me/tests/${testId}/package`).set(bearer(stu.MT26S0001.token));
    expect(other.status).toBe(409); // already submitted

    // The test closes before the tablet gets back online: the upload goes to staff review.
    await pool.query(`update tests set closes_at = now() - interval '1 hour' where id = $1`, [testId]);
    const r = await http
      .post(`${API}/me/tests/${testId}/submit`)
      .set(S)
      .send({ mode: 'OFFLINE', answers, packageToken: pkg.body.packageToken, clientSubmittedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(), elapsedSec: 420 })
      .expect(200);
    expect(r.body).toMatchObject({ mode: 'OFFLINE', reviewStatus: 'PENDING', result: null });
  });

  it('lets staff review late uploads and see question analytics', async () => {
    const pending = await http.get(`${API}/tests/reviews/pending`).set(bearer(teacher)).expect(200);
    expect(pending.body).toHaveLength(1);
    expect(pending.body[0].reviewReason).toMatch(/Uploaded after the test closed/);
    const res = await http.patch(`${API}/tests/${testId}/attempts/${pending.body[0].attemptId}/review`).set(bearer(teacher)).send({ decision: 'ACCEPTED', note: 'Hostel Wi-Fi outage' }).expect(200);
    expect(res.body.summary).toMatchObject({ eligible: 2, submitted: 2, counted: 2, pendingReview: 0, averagePercent: 71.9, highestPercent: 100 });
    expect(res.body.perQuestion[0]).toMatchObject({ correct: 2, correctPercent: 100 });
    expect(res.body.perQuestion[3]).toMatchObject({ correct: 1, answered: 1 });
  });

  it('shows answers after the test closes and builds the student’s results page', async () => {
    const S = bearer(stu.MT26S0001.token);
    const review = await http.get(`${API}/me/tests/${testId}/review`).set(S).expect(200);
    expect(review.body.questions[0]).toMatchObject({ correctIndex: 1, yourAnswer: 1, explanation: 'Φ = E·A' });
    const results = await http.get(`${API}/me/results`).set(S).expect(200);
    expect(results.body).toMatchObject({ averagePercent: 43.8, testsTaken: 1 });
    expect(results.body.subjects[0]).toMatchObject({ subjectCode: 'PHY', tests: 1 });
    expect(results.body.topicsToRevise.map((t: { topic: string }) => t.topic).sort()).toEqual(['Charging', 'Gauss’s law']);
  });
});

describe('attendance', () => {
  const roll = () => ({ kind: 'CLASS', date: today(), label: 'Period 1', sectionId: sectionA, subjectId: subj.PHY });

  it('enforces who may take which roll call', async () => {
    await http.get(`${API}/attendance/roster`).query(roll()).set(bearer(warden)).expect(403);
    await http.get(`${API}/attendance/roster`).query({ kind: 'HOSTEL', date: today(), label: 'Evening', hostelId }).set(bearer(teacher)).expect(403);
    const r = await http.get(`${API}/attendance/roster`).query(roll()).set(bearer(teacher)).expect(200);
    expect(r.body.students).toHaveLength(2);
    expect(r.body.session).toBeNull();
  });

  it('saves a roll call, refuses future dates, and needs a reason to change it', async () => {
    const T = bearer(teacher);
    const records = [
      { studentId: stu.MT26S0001.id, status: 'PRESENT' },
      { studentId: stu.MT26S0002.id, status: 'ABSENT' },
    ];
    const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    await http.put(`${API}/attendance/sessions`).set(T).send({ ...roll(), date: tomorrow, records }).expect(400);
    const first = await http.put(`${API}/attendance/sessions`).set(T).send({ ...roll(), records }).expect(200);
    expect(first.body).toMatchObject({ present: 1, absent: 1, corrected: 0 });
    const changed = [records[0], { studentId: stu.MT26S0002.id, status: 'LEAVE' }];
    await http.put(`${API}/attendance/sessions`).set(T).send({ ...roll(), records: changed }).expect(400);
    const fixed = await http.put(`${API}/attendance/sessions`).set(T).send({ ...roll(), records: changed, reason: 'Medical leave approved' }).expect(200);
    expect(fixed.body.corrected).toBe(1);
    const audit = await pool.query(`select metadata from audit_logs where action = 'attendance.correct'`);
    expect(audit.rows[0].metadata.changes[0]).toMatchObject({ from: 'ABSENT', to: 'LEAVE' });
  });

  it('lets wardens take their own hostel roll call', async () => {
    await http
      .put(`${API}/attendance/sessions`)
      .set(bearer(warden))
      .send({ kind: 'HOSTEL', date: today(), label: 'Evening roll call', hostelId, records: [{ studentId: stu.MT26S0001.id, status: 'PRESENT' }, { studentId: stu.MT26S0002.id, status: 'PRESENT' }] })
      .expect(200);
  });

  it('refuses roll calls on holidays', async () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await http.post(`${API}/holidays`).set(bearer(admin)).send({ date: yesterday, name: 'Kannada Rajyotsava' }).expect(201);
    await http
      .put(`${API}/attendance/sessions`)
      .set(bearer(admin))
      .send({ ...roll(), date: yesterday, records: [{ studentId: stu.MT26S0001.id, status: 'PRESENT' }] })
      .expect(400);
  });

  it('builds the student calendar and staff trend', async () => {
    const cal = await http.get(`${API}/me/attendance`).set(bearer(stu.MT26S0002.token)).expect(200);
    const day = cal.body.days.find((d: { date: string }) => d.date === today());
    expect(day.status).toBe('PRESENT'); // leave + present → present
    expect(cal.body.monthPercent).toBe(100);
    const trend = await http.get(`${API}/attendance/trend`).set(bearer(admin)).expect(200);
    expect(trend.body.at(-1)).toMatchObject({ date: today(), present: 3, absent: 0, percent: 100 });
  });
});

describe('notices', () => {
  let noticeId: string;

  it('scopes who teachers and wardens can address', async () => {
    await http.post(`${API}/notices`).set(bearer(teacher)).send({ title: 'Hi all', body: 'Everyone', category: 'GENERAL', audienceType: 'ALL' }).expect(403);
    await http.post(`${API}/notices`).set(bearer(teacher)).send({ title: 'Other class', body: 'x x x', category: 'GENERAL', audienceType: 'CLASS', audienceId: otherClassId }).expect(403);
    noticeId = (
      await http.post(`${API}/notices`).set(bearer(teacher)).send({ title: 'Unit test on Friday', body: 'Revise Gauss’s law.', category: 'EXAM', audienceType: 'CLASS', audienceId: classId }).expect(201)
    ).body.id;
    await http.post(`${API}/notices`).set(bearer(warden)).send({ title: 'Study hours', body: '6:30 to 9:30 pm', category: 'HOSTEL', audienceType: 'HOSTEL', audienceId: hostelId }).expect(201);
  });

  it('delivers to students and tracks reads', async () => {
    const S = bearer(stu.MT26S0001.token);
    const list = await http.get(`${API}/me/notices`).set(S).expect(200);
    expect(list.body).toHaveLength(2);
    expect(list.body.every((n: { readAt: string | null }) => n.readAt === null)).toBe(true);
    await http.post(`${API}/me/notices/${noticeId}/read`).set(S).expect(200);
    const staff = await http.get(`${API}/notices`).set(bearer(admin)).expect(200);
    expect(staff.body.items.find((n: { id: string }) => n.id === noticeId)).toMatchObject({ readCount: 1, audienceSize: 2, audienceName: '2nd PUC PCMB' });
  });
});

describe('live classes', () => {
  it('accepts only approved meeting platforms', async () => {
    const base = { classId, subjectId: subj.PHY, title: 'Gauss’s law doubts', startsAt: new Date(Date.now() - 60_000).toISOString(), endsAt: new Date(Date.now() + 3_600_000).toISOString() };
    await http.post(`${API}/live-classes`).set(bearer(teacher)).send({ ...base, joinUrl: 'https://example.com/room' }).expect(400);
    const live = await http.post(`${API}/live-classes`).set(bearer(teacher)).send({ ...base, joinUrl: 'https://meet.jit.si/mt-2puc-physics' }).expect(201);
    expect(live.body).toMatchObject({ state: 'live', teacherName: 'Prakash Joshi' });
    await http
      .post(`${API}/live-classes`)
      .set(bearer(teacher))
      .send({ ...base, title: 'Next week', startsAt: new Date(Date.now() + 5 * 86_400_000).toISOString(), endsAt: new Date(Date.now() + 5 * 86_400_000 + 3_600_000).toISOString(), joinUrl: 'https://meet.jit.si/mt-later' })
      .expect(201);
  });

  it('shows the join link only while joining is open, and carries questions both ways', async () => {
    const S = bearer(stu.MT26S0001.token);
    const list = await http.get(`${API}/me/live-classes`).set(S).expect(200);
    const now = list.body.find((l: { state: string }) => l.state === 'live');
    const later = list.body.find((l: { state: string }) => l.state === 'scheduled');
    expect(now.joinUrl).toBe('https://meet.jit.si/mt-2puc-physics');
    expect(later.joinUrl).toBeNull();
    await http.post(`${API}/live-classes/${now.id}/questions`).set(S).send({ body: 'Why is the field zero inside?' }).expect(201);
    await http.post(`${API}/live-classes/${now.id}/questions`).set(bearer(teacher)).send({ body: 'No charge is enclosed.' }).expect(201);
    const qs = await http.get(`${API}/live-classes/${now.id}/questions`).set(S).expect(200);
    expect(qs.body.map((q: { authorName: string }) => q.authorName)).toEqual(['Ananya Rao', 'Prakash Joshi']);
  });
});

describe('student home and dashboard', () => {
  it('returns everything the tablet home screen needs', async () => {
    const r = await http.get(`${API}/me/student/home`).set(bearer(stu.MT26S0001.token)).expect(200);
    expect(r.body.subjects.find((s: { code: string }) => s.code === 'PHY')).toMatchObject({ materialsTotal: 1, materialsCompleted: 1, progressPercent: 100, teacherNames: ['Prakash Joshi'] });
    expect(r.body.today.periods).toHaveLength(2);
    expect(r.body.today.periods.some((p: { status: string }) => p.status === 'now')).toBe(true);
    expect(r.body.notices.unread).toBe(1);
    expect(r.body.liveNow).toHaveLength(1);
    expect(r.body.results).toMatchObject({ averagePercent: 43.8, testsTaken: 1 });
    expect(r.body.attendance.monthPercent).toBe(100);
  });

  it('adds attendance and test figures to the staff dashboard', async () => {
    const r = await http.get(`${API}/dashboard/summary`).set(bearer(admin)).expect(200);
    expect(r.body.attendance.today).toMatchObject({ percent: 100 });
    expect(r.body.tests).toMatchObject({ submittedThisWeek: 2, pendingReviews: 0 });
    expect(r.body.classPerformance[0]).toMatchObject({ className: '2nd PUC PCMB', sectionName: 'A', attempts: 2 });
  });
});

describe('remote wipe of lost tablets', () => {
  it('tells a lost tablet to sign out and wipe', async () => {
    const A = bearer(admin);
    const t = await http.post(`${API}/tablets`).set(A).send({ serialNumber: 'R9TX0011', model: 'Galaxy Tab A9+' }).expect(201);
    await http.post(`${API}/tablets/${t.body.id}/assign`).set(A).send({ studentId: stu.MT26S0001.id }).expect(200);
    const S = bearer(stu.MT26S0001.token);
    expect((await http.post(`${API}/me/device/heartbeat`).set(S).send({ serialNumber: 'R9TX0011' }).expect(200)).body).toEqual({ matched: true, action: 'NONE' });
    await http.patch(`${API}/tablets/${t.body.id}/status`).set(A).send({ status: 'LOST' }).expect(200);
    expect((await http.post(`${API}/me/device/heartbeat`).set(S).send({ serialNumber: 'R9TX0011' }).expect(200)).body).toEqual({ matched: false, action: 'SIGN_OUT_AND_WIPE' });
  });
});
