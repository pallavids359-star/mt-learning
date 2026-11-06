import { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import request from 'supertest';
import { bearer, setupApp, staffToken } from './helpers';

/** Live exam monitor: progress from tablets, counts, and the staff rescue actions. */

const API = '/api/v1';
let app: INestApplication;
let http: ReturnType<typeof request>;
let pool: Pool;
let admin: string;
const tokens: Record<string, string> = {};
let testId: string;
let qids: string[];
let classId: string;
let sectionId: string;

async function studentLogin(code: string, password: string) {
  const r = await http.post(`${API}/auth/student/login`).send({ studentCode: code, secret: password }).expect(200);
  await http.post(`${API}/auth/change-password`).set(bearer(r.body.accessToken)).send({ currentPassword: password, newPassword: 'Student123' }).expect(204);
  return (await http.post(`${API}/auth/student/login`).send({ studentCode: code, secret: 'Student123' }).expect(200)).body.accessToken as string;
}

beforeAll(async () => {
  ({ app, http, pool } = await setupApp());
  admin = await staffToken(http);
  const A = bearer(admin);
  const year = await http.post(`${API}/academic-years`).set(A).send({ name: '2026-27', startDate: '2026-06-01', endDate: '2027-03-31', isCurrent: true }).expect(201);
  const subject = (await http.post(`${API}/subjects`).set(A).send({ code: 'PHY', name: 'Physics' }).expect(201)).body.id;
  const c = await http
    .post(`${API}/classes`)
    .set(A)
    .send({ academicYearId: year.body.id, pucYear: 'PUC_2', stream: 'PCMB', name: '2nd PUC PCMB', sectionNames: ['A'], subjectIds: [subject] })
    .expect(201);
  classId = c.body.id;
  sectionId = c.body.sections[0].id;
  for (const code of ['MT26S0201', 'MT26S0202', 'MT26S0203']) {
    const r = await http.post(`${API}/students`).set(A).send({ studentCode: code, fullName: `Student ${code.slice(-1)}`, sectionId: c.body.sections[0].id, rollNumber: code.slice(-2) }).expect(201);
    tokens[code] = await studentLogin(code, r.body.temporaryPassword);
  }
  const now = Date.now();
  const t = await http
    .post(`${API}/tests`)
    .set(A)
    .send({
      classId: c.body.id,
      subjectId: subject,
      title: 'Monitor test',
      durationMin: 30,
      opensAt: new Date(now - 60_000).toISOString(),
      closesAt: new Date(now + 3_600_000).toISOString(),
      questions: [1, 2, 3, 4].map((n) => ({ text: `Question ${n}`, options: ['a', 'b', 'c', 'd'], correctIndex: 0, marks: 1 })),
    })
    .expect(201);
  testId = t.body.id;
  await http.post(`${API}/tests/${testId}/publish`).set(A).expect(200);
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe('live monitor', () => {
  let attemptA: string;
  let attemptB: string;

  it('shows progress, battery and status for each student', async () => {
    const s1 = await http.post(`${API}/me/tests/${testId}/start`).set(bearer(tokens.MT26S0201)).send({ deviceSerial: 'TAB-001' }).expect(200);
    attemptA = s1.body.attemptId;
    qids = s1.body.paper.questions.map((q: { id: string }) => q.id);
    expect(s1.body.currentQuestion).toBe(1);
    await http
      .post(`${API}/me/tests/${testId}/progress`)
      .set(bearer(tokens.MT26S0201))
      .send({ attemptId: attemptA, currentQuestion: 3, answers: { [qids[0]]: 0, [qids[1]]: null }, skipped: 1, battery: 85, charging: false })
      .expect(200)
      .expect((r) => expect(r.body.status).toBe('ok'));
    attemptB = (await http.post(`${API}/me/tests/${testId}/start`).set(bearer(tokens.MT26S0202)).send({}).expect(200)).body.attemptId;
    await pool.query(`UPDATE test_attempts SET last_seen_at = now() - interval '5 minutes' WHERE id = $1`, [attemptB]);

    const m = await http.get(`${API}/tests/${testId}/monitor`).set(bearer(admin)).expect(200);
    expect(m.body.summary).toMatchObject({ total: 3, active: 1, inactive: 1, notStarted: 1, submitted: 0, notSubmitted: 3 });
    const a = m.body.students.find((s: { attemptId: string }) => s.attemptId === attemptA);
    expect(a).toMatchObject({ status: 'active', tablet: 'TAB-001', battery: 85, currentQuestion: 3, attended: 1, left: 3, skipped: 1, submission: 'not_submitted' });
    expect(a.remainingSec).toBeGreaterThan(1700);
  });

  it('force-submits saved answers and tells the tablet', async () => {
    await http.post(`${API}/tests/${testId}/attempts/${attemptA}/force-submit`).set(bearer(admin)).expect(200);
    await http.post(`${API}/tests/${testId}/attempts/${attemptA}/force-submit`).set(bearer(admin)).expect(409);
    const p = await http.post(`${API}/me/tests/${testId}/progress`).set(bearer(tokens.MT26S0201)).send({ attemptId: attemptA, currentQuestion: 3, answers: {} }).expect(200);
    expect(p.body).toMatchObject({ status: 'submitted', byStaff: true });
    const m = await http.get(`${API}/tests/${testId}/monitor`).set(bearer(admin)).expect(200);
    expect(m.body.students.find((s: { attemptId: string }) => s.attemptId === attemptA)).toMatchObject({ status: 'submitted', submittedByStaff: true, score: 1 });
  });

  it('revives a submitted attempt so the student continues from the same question with their answers', async () => {
    const r = await http.post(`${API}/tests/${testId}/attempts/${attemptA}/revive`).set(bearer(admin)).send({ minutes: 10 }).expect(200);
    expect(new Date(r.body.deadline).getTime()).toBeGreaterThan(Date.now());
    const list = await http.get(`${API}/me/tests`).set(bearer(tokens.MT26S0201)).expect(200);
    expect(list.body.find((t: { id: string }) => t.id === testId)).toMatchObject({ canStart: true, attempt: { status: 'IN_PROGRESS', revived: true } });
    const s = await http.post(`${API}/me/tests/${testId}/start`).set(bearer(tokens.MT26S0201)).send({}).expect(200);
    expect(s.body).toMatchObject({ attemptId: attemptA, currentQuestion: 3, answers: { [qids[0]]: 0 } });
    const sub = await http.post(`${API}/me/tests/${testId}/submit`).set(bearer(tokens.MT26S0201)).send({ mode: 'ONLINE', answers: { [qids[0]]: 0, [qids[1]]: 0 } }).expect(200);
    expect(sub.body.reviewStatus).toBe('NONE');
  });

  it('a revived attempt can continue after the test has closed', async () => {
    await pool.query(`UPDATE tests SET closes_at = now() - interval '1 minute' WHERE id = $1`, [testId]);
    await http.post(`${API}/me/tests/${testId}/start`).set(bearer(tokens.MT26S0202)).send({}).expect(409);
    await http.post(`${API}/tests/${testId}/attempts/${attemptB}/revive`).set(bearer(admin)).send({ minutes: 5 }).expect(200);
    await http.post(`${API}/me/tests/${testId}/start`).set(bearer(tokens.MT26S0202)).send({}).expect(200);
    await pool.query(`UPDATE tests SET closes_at = now() + interval '1 hour' WHERE id = $1`, [testId]);
  });

  it('restart gives a new attempt and tells the old tablet to start again', async () => {
    await http.post(`${API}/tests/${testId}/attempts/${attemptB}/restart`).set(bearer(admin)).expect(200);
    const p = await http.post(`${API}/me/tests/${testId}/progress`).set(bearer(tokens.MT26S0202)).send({ attemptId: attemptB, currentQuestion: 2, answers: {} }).expect(200);
    expect(p.body.status).toBe('reset');
    const s = await http.post(`${API}/me/tests/${testId}/start`).set(bearer(tokens.MT26S0202)).send({}).expect(200);
    expect(s.body.attemptId).not.toBe(attemptB);
    expect(s.body.currentQuestion).toBe(1);
    const audit = await pool.query(`SELECT action FROM audit_logs WHERE action LIKE 'test.%' ORDER BY created_at`);
    expect(audit.rows.map((r) => r.action)).toEqual(expect.arrayContaining(['test.force_submit', 'test.revive', 'test.restart']));
  });

  it('is for staff with test permissions only', async () => {
    await http.get(`${API}/tests/${testId}/monitor`).set(bearer(tokens.MT26S0203)).expect(403);
  });

  it('gives a marks sheet for a class or section, highest first', async () => {
    const r = await http.get(`${API}/tests/marks`).query({ classId, sectionId }).set(bearer(admin)).expect(200);
    expect(r.body.tests).toHaveLength(1);
    expect(r.body.tests[0].maxScore).toBe(4);
    expect(r.body.students).toHaveLength(3);
    const first = r.body.students[0];
    expect(first).toMatchObject({ studentCode: 'MT26S0201', rank: 1, testsTaken: 1, total: 2, outOf: 4, percent: 50 });
    expect(r.body.students[1].rank).toBeNull();
    await http.get(`${API}/tests/marks`).set(bearer(admin)).expect(400);
    await http.get(`${API}/tests/marks`).query({ classId }).set(bearer(tokens.MT26S0203)).expect(403);
  });
});
