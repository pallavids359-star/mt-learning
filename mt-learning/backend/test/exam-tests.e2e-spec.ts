import { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import request from 'supertest';
import { bearer, setupApp, staffToken } from './helpers';

/** Exam tests: set for Class 11, Class 12 or both, with the subjects of NEET, JEE or KCET. */

const API = '/api/v1';
let app: INestApplication;
let http: ReturnType<typeof request>;
let pool: Pool;
let admin: string;
const tok: Record<string, string> = {};
let puc1: string;
let puc2: string;

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
  const mk = async (pucYear: string, name: string) =>
    (await http.post(`${API}/classes`).set(A).send({ academicYearId: year.body.id, pucYear, stream: 'PCMB', name, sectionNames: ['A', 'B'], subjectIds: [subject] }).expect(201)).body;
  const c1 = await mk('PUC_1', '1st PUC PCMB');
  const c2 = await mk('PUC_2', '2nd PUC PCMB');
  puc1 = c1.id;
  puc2 = c2.id;
  for (const [code, sec] of [
    ['MT26S0301', c1.sections[0].id],
    ['MT26S0302', c2.sections[0].id],
    ['MT26S0303', c2.sections[1].id],
  ] as const) {
    const r = await http.post(`${API}/students`).set(A).send({ studentCode: code, fullName: `Student ${code.slice(-1)}`, sectionId: sec, rollNumber: code.slice(-2) }).expect(201);
    tok[code] = await studentLogin(code, r.body.temporaryPassword);
  }
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

const window = () => ({ opensAt: new Date(Date.now() - 60_000).toISOString(), closesAt: new Date(Date.now() + 4 * 3_600_000).toISOString() });
const q = (subject: string, n: number) => ({ text: `${subject} question ${n}`, options: ['a', 'b', 'c', 'd'], correctIndex: 0, marks: 4, subject });

describe('exam tests', () => {
  let neet12: string;
  let both: string;

  it('a NEET test for Class 12 takes NEET subjects and marking, and only Class 12 students see it', async () => {
    const r = await http
      .post(`${API}/tests`)
      .set(bearer(admin))
      .send({ audience: 'PUC_2', examCode: 'NEET', title: 'NEET weekly test', durationMin: 180, ...window(), questions: [q('Physics', 1), q('Biology', 2)] })
      .expect(201);
    neet12 = r.body.id;
    expect(r.body).toMatchObject({ audience: 'PUC_2', examCode: 'NEET', subjects: ['Physics', 'Chemistry', 'Biology'], negativeMarks: 1, className: 'Class 12 · NEET', classId: null });
    expect(r.body.questions.map((x: { subject: string }) => x.subject)).toEqual(['Physics', 'Biology']);
    await http.post(`${API}/tests/${neet12}/publish`).set(bearer(admin)).expect(200);

    const see = async (code: string) => (await http.get(`${API}/me/tests`).set(bearer(tok[code])).expect(200)).body.map((t: { id: string }) => t.id);
    expect(await see('MT26S0302')).toContain(neet12);
    expect(await see('MT26S0303')).toContain(neet12);
    expect(await see('MT26S0301')).not.toContain(neet12);
    await http.post(`${API}/me/tests/${neet12}/start`).set(bearer(tok.MT26S0301)).send({}).expect(404);
    const start = await http.post(`${API}/me/tests/${neet12}/start`).set(bearer(tok.MT26S0302)).send({}).expect(200);
    expect(start.body.paper).toMatchObject({ subjectCode: 'NEET', subjectName: 'Physics, Chemistry, Biology' });
    expect(start.body.paper.questions[0].subject).toBe('Physics');
  });

  it('a test for both years reaches every student, in the list, monitor and marks sheet', async () => {
    const r = await http
      .post(`${API}/tests`)
      .set(bearer(admin))
      .send({ audience: 'BOTH', examCode: 'KCET', title: 'KCET mock', durationMin: 240, ...window(), questions: [q('Mathematics', 1)] })
      .expect(201);
    both = r.body.id;
    expect(r.body).toMatchObject({ subjects: ['Physics', 'Chemistry', 'Mathematics', 'Biology'], negativeMarks: 0 });
    await http.post(`${API}/tests/${both}/publish`).set(bearer(admin)).expect(200);
    for (const code of ['MT26S0301', 'MT26S0302', 'MT26S0303']) {
      const list = (await http.get(`${API}/me/tests`).set(bearer(tok[code])).expect(200)).body;
      expect(list.map((t: { id: string }) => t.id)).toContain(both);
    }
    const m = await http.get(`${API}/tests/${both}/monitor`).set(bearer(admin)).expect(200);
    expect(m.body.summary.total).toBe(3);
    const neetMon = await http.get(`${API}/tests/${neet12}/monitor`).set(bearer(admin)).expect(200);
    expect(neetMon.body.summary.total).toBe(2);

    const listed = await http.get(`${API}/tests`).query({ classId: puc1 }).set(bearer(admin)).expect(200);
    expect(listed.body.items.map((t: { id: string }) => t.id)).toEqual([both]);
    expect(listed.body.items[0]).toMatchObject({ className: 'Class 11 and 12 · KCET', studentCount: 3 });

    const s = await http.post(`${API}/me/tests/${both}/start`).set(bearer(tok.MT26S0301)).send({}).expect(200);
    await http.post(`${API}/me/tests/${both}/submit`).set(bearer(tok.MT26S0301)).send({ mode: 'ONLINE', answers: { [s.body.paper.questions[0].id]: 0 } }).expect(200);
    const sheet = await http.get(`${API}/tests/marks`).query({ classId: puc1 }).set(bearer(admin)).expect(200);
    expect(sheet.body.tests.map((t: { id: string }) => t.id)).toEqual([both]);
    expect(sheet.body.students[0]).toMatchObject({ studentCode: 'MT26S0301', rank: 1, total: 4 });
    const sheet12 = await http.get(`${API}/tests/marks`).query({ classId: puc2 }).set(bearer(admin)).expect(200);
    expect(sheet12.body.tests.map((t: { id: string }) => t.id).sort()).toEqual([neet12, both].sort());
  });

  it('needs both the class and the exam', async () => {
    const base = { title: 'Half done', durationMin: 60, ...window() };
    await http.post(`${API}/tests`).set(bearer(admin)).send({ ...base, audience: 'PUC_1' }).expect(400);
    await http.post(`${API}/tests`).set(bearer(admin)).send({ ...base, audience: 'PUC_1', examCode: 'CET' }).expect(400);
    await http.post(`${API}/tests`).set(bearer(admin)).send(base).expect(400);
  });
});
