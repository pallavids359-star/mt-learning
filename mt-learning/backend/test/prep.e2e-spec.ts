import { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import request from 'supertest';
import { bearer, setupApp, staffToken } from './helpers';

/** GenPrep-style practice against the built-in sample bank (GENPREP_MONGO_URI is not set in tests). */

const API = '/api/v1';
let app: INestApplication;
let http: ReturnType<typeof request>;
let pool: Pool;
let admin: string;
let student: string;
let other: string;
let neet: string;
let physicsChapter: string;

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
  const section = c.body.sections[0].id;
  for (const [code, name] of [
    ['MT26S0101', 'Ananya Rao'],
    ['MT26S0102', 'Ravi Kumar'],
  ]) {
    const r = await http.post(`${API}/students`).set(A).send({ studentCode: code, fullName: name, sectionId: section, rollNumber: code.slice(-2) }).expect(201);
    const token = await studentLogin(code, r.body.temporaryPassword);
    if (code.endsWith('1')) student = token;
    else other = token;
  }
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe('exams and syllabus', () => {
  it('lists the exams and remembers the student’s target', async () => {
    const S = bearer(student);
    const r = await http.get(`${API}/me/prep/exams`).set(S).expect(200);
    expect(r.body.source).toBe('sample');
    expect(r.body.exams.map((e: { code: string }) => e.code)).toEqual(['NEET', 'JEE', 'KCET']);
    expect(r.body.targetExamId).toBeNull();
    neet = r.body.exams[0].id;
    expect((await http.put(`${API}/me/prep/target`).set(S).send({ examId: neet }).expect(200)).body.targetExamId).toBe(neet);
    await http.put(`${API}/me/prep/target`).set(S).send({ examId: 'nope' }).expect(404);
  });

  it('shows subjects, chapters and topics', async () => {
    const r = await http.get(`${API}/me/prep/syllabus`).query({ examId: neet }).set(bearer(student)).expect(200);
    expect(r.body.subjects.map((s: { name: string }) => s.name)).toEqual(['Physics', 'Chemistry', 'Biology']);
    const ch = r.body.subjects[0].chapters[0];
    expect(ch).toMatchObject({ name: 'Units and Measurements', classLevel: '11', questionCount: 4, attempted: 0, accuracy: null });
    physicsChapter = ch.id;
    const t = await http.get(`${API}/me/prep/chapters/${physicsChapter}/topics`).set(bearer(student)).expect(200);
    expect(t.body).toHaveLength(2);
  });

  it('is for students only', async () => {
    await http.get(`${API}/me/prep/exams`).set(bearer(admin)).expect(403);
    await http.get(`${API}/me/prep/exams`).expect(401);
  });
});

describe('practice', () => {
  let attemptId: string;
  let questions: { id: string; type: string; options: { id: string }[] }[];

  it('starts a practice set without revealing answers', async () => {
    const r = await http.post(`${API}/me/prep/practice`).set(bearer(student)).send({ examId: neet, chapterIds: [physicsChapter], count: 10 }).expect(201);
    attemptId = r.body.attemptId;
    questions = r.body.questions;
    expect(r.body).toMatchObject({ mode: 'practice', title: 'Units and Measurements', status: 'in_progress', remainingSec: null });
    expect(questions).toHaveLength(4);
    const text = JSON.stringify(r.body);
    expect(text).not.toContain('correctOptionIds');
    expect(text).not.toContain('explanation');
  });

  it('narrows to ticked topics and difficulty', async () => {
    const topics = (await http.get(`${API}/me/prep/chapters/${physicsChapter}/topics`).set(bearer(other)).expect(200)).body;
    const r = await http
      .post(`${API}/me/prep/practice`)
      .set(bearer(other))
      .send({ examId: neet, chapterIds: [physicsChapter], topicIds: [topics[0].id], difficulty: 'easy', count: 10 })
      .expect(201);
    expect(r.body.questions).toHaveLength(1);
    await http.post(`${API}/me/prep/practice`).set(bearer(other)).send({ examId: neet, chapterIds: ['missing'] }).expect(400);
  });

  it('autosaves, then scores with +4 / −1 and shows the review', async () => {
    const S = bearer(student);
    // Answer everything with "A": exactly one Units question has A as the answer
    const answers = questions.map((q) => ({ questionId: q.id, selected: ['A'], timeSec: 20 }));
    await http.put(`${API}/me/prep/attempts/${attemptId}/answers`).set(S).send({ answers: answers.slice(0, 2) }).expect(200);
    const mid = await http.get(`${API}/me/prep/attempts/${attemptId}`).set(S).expect(200);
    expect(mid.body.answers.filter((a: { selected: string[] }) => a.selected.length)).toHaveLength(2);

    const r = await http.post(`${API}/me/prep/attempts/${attemptId}/submit`).set(S).send({ answers }).expect(200);
    expect(r.body.status).toBe('submitted');
    expect(r.body.result).toMatchObject({ correct: 1, incorrect: 3, unanswered: 0, score: 1, maxScore: 16, accuracy: 25, timeTakenSec: 80 });
    expect(r.body.result.chapters[0]).toMatchObject({ name: 'Units and Measurements', correct: 1, attempted: 4 });
    const first = r.body.review.find((x: { correctOptionIds: string[] }) => x.correctOptionIds[0] === 'A');
    expect(first).toMatchObject({ isCorrect: true, marksAwarded: 4 });
    expect(first.explanation.text).toContain('MLT');

    // A retry returns the same result instead of an error
    const again = await http.post(`${API}/me/prep/attempts/${attemptId}/submit`).set(S).send({ answers: [] }).expect(200);
    expect(again.body.result.score).toBe(1);
    await http.put(`${API}/me/prep/attempts/${attemptId}/answers`).set(S).send({ answers }).expect(409);
  });

  it('keeps attempts private to their student', async () => {
    await http.get(`${API}/me/prep/attempts/${attemptId}`).set(bearer(other)).expect(404);
  });

  it('feeds wrong answers into revision, and correct ones take them out', async () => {
    const S = bearer(student);
    const r = await http.post(`${API}/me/prep/revise/wrong`).set(S).send({ examId: neet, count: 10 }).expect(201);
    expect(r.body.mode).toBe('wrong');
    expect(r.body.questions).toHaveLength(3);
    // Answer them all correctly using the review of the first attempt
    const review = (await http.get(`${API}/me/prep/attempts/${attemptId}`).set(S).expect(200)).body.review as { questionId: string; correctOptionIds: string[] }[];
    const key = new Map(review.map((x) => [x.questionId, x.correctOptionIds]));
    const answers = r.body.questions.map((q: { id: string }) => ({ questionId: q.id, selected: key.get(q.id) }));
    await http.post(`${API}/me/prep/attempts/${r.body.attemptId}/submit`).set(S).send({ answers }).expect(200);
    await http.post(`${API}/me/prep/revise/wrong`).set(S).send({ examId: neet }).expect(404);
  });
});

describe('bookmarks', () => {
  it('saves, revises and removes bookmarks', async () => {
    const S = bearer(student);
    await http.post(`${API}/me/prep/revise/bookmarks`).set(S).send({ examId: neet }).expect(404);
    const qid = `${physicsChapter}-q2`;
    await http.post(`${API}/me/prep/bookmarks`).set(S).send({ questionId: qid }).expect(200);
    await http.post(`${API}/me/prep/bookmarks`).set(S).send({ questionId: qid }).expect(200); // twice is fine
    const list = await http.get(`${API}/me/prep/bookmarks`).query({ examId: neet }).set(S).expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ questionId: qid, subjectName: 'Physics', chapterName: 'Units and Measurements' });
    const r = await http.post(`${API}/me/prep/revise/bookmarks`).set(S).send({ examId: neet }).expect(201);
    expect(r.body.questions.map((q: { id: string }) => q.id)).toEqual([qid]);
    await http.delete(`${API}/me/prep/bookmarks/${qid}`).set(S).expect(204);
    expect((await http.get(`${API}/me/prep/bookmarks`).query({ examId: neet }).set(S).expect(200)).body).toHaveLength(0);
    await http.post(`${API}/me/prep/bookmarks`).set(S).send({ questionId: 'missing' }).expect(404);
  });
});

describe('mock tests', () => {
  let mockId: string;

  it('builds a timed mock from the exam pattern and resumes it', async () => {
    const S = bearer(other);
    const r = await http.post(`${API}/me/prep/mock`).set(S).send({ examId: neet }).expect(201);
    mockId = r.body.attemptId;
    expect(r.body).toMatchObject({ mode: 'mock', title: 'NEET Mock Test 1' });
    expect(r.body.questions).toHaveLength(28); // all of the sample bank's NEET questions (12 + 8 + 8)
    expect(r.body.remainingSec).toBeGreaterThan(179 * 60);
    const again = await http.post(`${API}/me/prep/mock`).set(S).send({ examId: neet }).expect(201);
    expect(again.body.attemptId).toBe(mockId);
  });

  it('auto-submits after the deadline using the last saved answers', async () => {
    const S = bearer(other);
    const q = (await http.get(`${API}/me/prep/attempts/${mockId}`).set(S).expect(200)).body.questions[0];
    await http.put(`${API}/me/prep/attempts/${mockId}/answers`).set(S).send({ answers: [{ questionId: q.id, selected: ['B'] }] }).expect(200);
    await pool.query(`UPDATE prep_attempts SET expires_at = now() - interval '5 minutes' WHERE id = $1`, [mockId]);
    // Answers sent after the deadline are ignored
    const r = await http
      .post(`${API}/me/prep/attempts/${mockId}/submit`)
      .set(S)
      .send({ answers: [{ questionId: q.id, selected: ['A'] }] })
      .expect(200);
    expect(r.body.status).toBe('auto_submitted');
    expect(r.body.review[0].selected).toEqual(['B']);
    const list = await http.get(`${API}/me/prep/mocks`).query({ examId: neet }).set(S).expect(200);
    expect(list.body[0]).toMatchObject({ attemptId: mockId, status: 'auto_submitted' });
  });

  it('scores numerical and multi-answer questions', async () => {
    const S = bearer(other);
    const jee = (await http.get(`${API}/me/prep/exams`).set(S).expect(200)).body.exams[1].id;
    const syl = (await http.get(`${API}/me/prep/syllabus`).query({ examId: jee }).set(S).expect(200)).body;
    const chem = syl.subjects[1].chapters[1].id; // Chemical bonding: includes a multi-answer question
    const maths = syl.subjects[2].chapters[0].id; // Quadratics: includes a numerical
    const r = await http.post(`${API}/me/prep/practice`).set(S).send({ examId: jee, chapterIds: [chem, maths], count: 60 }).expect(201);
    const answers = r.body.questions.map((q: { id: string; type: string }) =>
      q.type === 'numerical' ? { questionId: q.id, numerical: q.id.endsWith('q4') ? 7 : 0 } : q.type === 'mcq_multi' ? { questionId: q.id, selected: ['C', 'A'] } : { questionId: q.id },
    );
    const done = await http.post(`${API}/me/prep/attempts/${r.body.attemptId}/submit`).set(S).send({ answers }).expect(200);
    const multi = done.body.review.find((x: { type: string }) => x.type === 'mcq_multi');
    const num = done.body.review.find((x: { type: string }) => x.type === 'numerical');
    expect(multi).toMatchObject({ isCorrect: true, marksAwarded: 4, correctOptionIds: ['A', 'C'] });
    expect(num).toMatchObject({ isCorrect: true, numericalAnswer: 7 });
  });
});

describe('dashboard and analytics', () => {
  it('summarises progress, weak chapters and recent work', async () => {
    const S = bearer(student);
    const d = await http.get(`${API}/me/prep/dashboard`).query({ examId: neet }).set(S).expect(200);
    expect(d.body.totals).toMatchObject({ attempted: 7, correct: 4, incorrect: 3, testsTaken: 2 });
    expect(d.body.streak.current).toBe(1);
    expect(d.body.last7Days).toHaveLength(7);
    expect(d.body.last7Days[6].attempted).toBe(7);
    expect(d.body.wrongQuestionsCount).toBe(0);
    expect(d.body.recent[0].mode).toBe('wrong');
    const syl = await http.get(`${API}/me/prep/syllabus`).query({ examId: neet }).set(S).expect(200);
    expect(syl.body.subjects[0].chapters[0]).toMatchObject({ attempted: 7, accuracy: 57 });
  });

  it('shows analytics and history', async () => {
    const S = bearer(other);
    const a = await http.get(`${API}/me/prep/analytics`).query({ examId: neet }).set(S).expect(200);
    expect(a.body.totals).toMatchObject({ mocksTaken: 1, practiceSessions: 0 }); // their NEET practice was never submitted
    expect(a.body.mocks[0].title).toBe('NEET Mock Test 1');
    expect(a.body.daily).toHaveLength(30);
    const h = await http.get(`${API}/me/prep/history`).query({ examId: neet }).set(S).expect(200);
    expect(h.body.items.map((x: { modeLabel: string }) => x.modeLabel)).toEqual(['Mock test']);
  });
});

describe('question bank for live tests', () => {
  it('lets staff pick bank questions in live-test format', async () => {
    const A = bearer(admin);
    expect((await http.get(`${API}/question-bank/status`).set(A).expect(200)).body.source).toBe('sample');
    const exams = (await http.get(`${API}/question-bank/exams`).set(A).expect(200)).body;
    const syl = (await http.get(`${API}/question-bank/syllabus`).query({ examId: exams[0].id }).set(A).expect(200)).body;
    const ch = syl[0].chapters[0];
    const r = await http.get(`${API}/question-bank/questions`).query({ chapterId: ch.id }).set(A).expect(200);
    expect(r.body.total).toBe(4);
    expect(r.body.items[0]).toMatchObject({ bankQuestionId: `${ch.id}-q1`, correctIndex: 0, options: ['$[MLT^{-2}]$', '$[ML^2T^{-2}]$', '$[MLT^{-1}]$', '$[M^0LT^{-2}]$'] });
    await http.get(`${API}/question-bank/questions`).query({ chapterId: ch.id }).set(bearer(student)).expect(403);
  });
});
