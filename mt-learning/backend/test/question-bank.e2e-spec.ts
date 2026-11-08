import { Pool } from 'pg';
import { toLiveQuestion } from '../src/prep/prep.service';
import { parseNumber, SupabaseQuestionBank } from '../src/prep/supabase-bank';

/**
 * The Supabase question bank against a real `questions` table shaped exactly like GenPrep's,
 * filled with the four example rows from GenPrep plus rows that must be left out.
 */

const url = process.env.DATABASE_URL!;
let admin: Pool;
let bank: SupabaseQuestionBank;

const AR_OPTIONS = `A: A and R are true and R is the correct explanation.
B: A and R are true but R is not the correct explanation.
C: A is true but R is false.
D: A is false but R is true.`;

beforeAll(async () => {
  admin = new Pool({ connectionString: url, max: 1 });
  await admin.query(`drop schema if exists genprep cascade; create schema genprep;`);
  await admin.query(`create table genprep.questions (
    id uuid primary key default gen_random_uuid(), subject text, klass text, chapter text, topic text, exams text[],
    q_type text, question text, opt_a text, opt_b text, opt_c text, opt_d text, assertion text, reason text,
    predef_options text, column_a text[], column_b text[], match_options jsonb, num_answer text, correct_option text,
    solution_text text, created_at timestamptz default now(), review_status text, acceptance_status text)`);
  const ins = (cols: Record<string, unknown>) => {
    const keys = Object.keys(cols);
    return admin.query(`insert into genprep.questions (${keys.join(',')}) values (${keys.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(cols));
  };
  const base = { subject: 'Physics', klass: '12', chapter: 'Magnetism and Matter', review_status: 'pending', acceptance_status: 'pending' };
  await ins({ ...base, id: '11111111-1111-4111-8111-111111111111', topic: 'Magnetic Properties of Materials', exams: ['NEET'], q_type: 'mcq_single', question: 'Which statement is true?', opt_a: 'Diamagnet moment is zero.', opt_b: 'Paramagnet moment is zero.', opt_c: 'Ferromagnet moment is zero.', opt_d: 'Ferromagnet demagnetises fast.', correct_option: 'A', solution_text: 'All electrons are paired.' });
  await ins({ ...base, id: '22222222-2222-4222-8222-222222222222', topic: 'Magnetic Properties of Materials', exams: ['NEET', 'JEE'], q_type: 'assertion_reason', assertion: 'Permeability is independent of field.', reason: 'Permeability does not depend on temperature.', predef_options: AR_OPTIONS, correct_option: 'D', solution_text: 'Assertion is false.' });
  await ins({ ...base, id: '44444444-4444-4444-8444-444444444443', topic: 'The Bar Magnet', exams: ['NEET'], q_type: 'match', column_a: ['Magnetic poles', 'Magnetic axis'], column_b: ['Distance between poles', 'Line through the poles'], match_options: { A: '(a) – (i), (b) – (ii)', B: '(a) – (ii), (b) – (i)', C: '(a) – (i), (b) – (i)', D: '(a) – (ii), (b) – (ii)' }, correct_option: 'B' });
  await ins({ ...base, chapter: 'Alternating Current', topic: 'LCR', exams: ['JEE'], q_type: 'numerical', question: 'Find the current.', correct_option: '1/2', solution_text: 'I = V/R' });
  // Questions with pictures (counted by minImages).
  await ins({ ...base, id: '68686868-6868-4868-8868-686868686861', exams: ['KCET'], chapter: 'Ray Optics', q_type: 'mcq_single', question: 'Find the image distance in the figure. {{IMG::https://img.example/ray1.png}}', opt_a: '10 cm', opt_b: '20 cm', opt_c: '30 cm', opt_d: '40 cm', correct_option: 'A' });
  await ins({ ...base, id: '68686868-6868-4868-8868-686868686862', exams: ['KCET'], chapter: 'Ray Optics', q_type: 'mcq_single', question: 'Name the lens shown here: ![lens](https://img.example/lens.jpg)', opt_a: 'Convex', opt_b: 'Concave', opt_c: 'Plane', opt_d: 'Cylindrical', correct_option: 'A' });
  for (let i = 0; i < 6; i++) {
    await ins({ ...base, exams: ['KCET'], chapter: 'Ray Optics', q_type: 'mcq_single', question: `Which statement about refraction number ${i} is right?`, opt_a: 'One', opt_b: 'Two', opt_c: 'Three', opt_d: 'Four', correct_option: 'B' });
  }
  // Never shown: a missing picture, broken maths, an incomplete question, true / false.
  await ins({ ...base, id: '59595959-5959-4959-8959-595959595951', exams: ['NEET'], q_type: 'mcq_single', question: 'The graph of B against d is correctly shown by', opt_a: '[DIAGRAM REQUIRED]', opt_b: '[DIAGRAM REQUIRED]', opt_c: '[DIAGRAM REQUIRED]', opt_d: '[DIAGRAM REQUIRED]', correct_option: 'A' });
  await ins({ ...base, id: '59595959-5959-4959-8959-595959595952', exams: ['NEET'], q_type: 'mcq_single', question: 'The value of \\frac{1}{2} plus one half is', opt_a: '1', opt_b: '2', opt_c: '3', opt_d: '4', correct_option: 'A' });
  await ins({ ...base, id: '59595959-5959-4959-8959-595959595953', exams: ['NEET'], q_type: 'mcq_single', question: 'Which of these is a vector quantity?', opt_a: 'Speed', opt_b: 'Velocity', opt_c: '', opt_d: '', correct_option: 'B' });
  await ins({ ...base, id: '59595959-5959-4959-8959-595959595954', exams: ['NEET'], q_type: 'mcq_single', question: 'Diamagnets are repelled by a magnet.', opt_a: 'True', opt_b: 'False', opt_c: 'Cannot say', opt_d: 'None', correct_option: 'A' });
  await ins({ ...base, klass: '11', chapter: 'Units and Measurements', topic: '', exams: ['JEE MAIN'], q_type: 'mcq_single', question: 'Pick the two correct statements.', opt_a: 'a', opt_b: 'b', opt_c: 'c', opt_d: 'd', correct_option: 'A, C' });
  // Must be left out: a written answer, a rejected question, no correct option.
  await ins({ ...base, chapter: 'Alternating Current', topic: 'LCR', exams: ['JEE'], q_type: 'numerical', question: 'Explain.', num_answer: '(a) 1.7 × $10^7$ J (b) 5.4 H', correct_option: '' });
  await ins({ ...base, exams: ['FOUNDATION'], q_type: 'mcq_single', question: 'Other exam', opt_a: 'x', opt_b: 'y', correct_option: 'A' });
  await ins({ ...base, exams: ['NEET'], q_type: 'mcq_single', question: 'Rejected', opt_a: 'x', opt_b: 'y', correct_option: 'A', review_status: 'rejected' });
  await ins({ ...base, exams: ['NEET'], q_type: 'mcq_single', question: 'No answer', opt_a: 'x', opt_b: 'y', correct_option: '' });
  bank = new SupabaseQuestionBank(`${url}${url.includes('?') ? '&' : '?'}options=${encodeURIComponent('-c search_path=genprep')}`);
});

afterAll(async () => {
  await bank.close();
  await admin.query('drop schema if exists genprep cascade');
  await admin.end();
});

describe('question bank on Supabase', () => {
  it('builds exams, subjects, chapters and topics from the questions table', async () => {
    const exams = await bank.exams();
    expect(exams.map((e) => e.code)).toEqual(['NEET', 'JEE', 'KCET']);
    expect(exams[0]).toMatchObject({ id: 'NEET', name: 'NEET (UG)', durationMinutes: 180, marking: { correct: 4, incorrect: -1 } });
    const subjects = await bank.subjects('NEET');
    expect(subjects.map((s) => s.name)).toEqual(['Physics']);
    const chapters = await bank.chapters('NEET');
    expect(chapters).toHaveLength(1);
    expect(chapters[0]).toMatchObject({ name: 'Magnetism and Matter', classLevel: '12', questionCount: 3 });
    const topics = await bank.topics(chapters[0].id);
    expect(topics.map((t) => [t.name, t.questionCount])).toEqual([
      ['Magnetic Properties of Materials', 2],
      ['The Bar Magnet', 1],
    ]);
    const jee = await bank.chapters('JEE');
    expect(jee.map((c) => [c.name, c.classLevel, c.questionCount])).toEqual([
      ['Units and Measurements', '11', 1],
      ['Alternating Current', '12', 1],
      ['Magnetism and Matter', '12', 1],
    ]);
  });

  it('draws questions without answers and turns each GenPrep type into one MT Learning can show', async () => {
    const [ch] = await bank.chapters('NEET');
    const qs = await bank.sample({ examId: 'NEET', parts: [{ chapterId: ch.id }] }, 10);
    expect(qs).toHaveLength(3);
    for (const q of qs) expect(q).not.toHaveProperty('correctOptionIds');
    const full = await bank.questions(qs.map((q) => q.id));
    const ar = full.find((q) => q.text.includes('**Assertion (A):**'))!;
    expect(ar.options).toHaveLength(4);
    expect(ar.correctOptionIds).toEqual(['D']);
    const match = full.find((q) => q.text.includes('**Column I**'))!;
    expect(match.text).toContain('(a) Magnetic poles');
    expect(match.text).toContain('(ii) Line through the poles');
    expect(match.correctOptionIds).toEqual(['B']);
    expect(match.options[1].text).toBe('(a) – (ii), (b) – (i)');
    const mcq = full.find((q) => q.text === 'Which statement is true?')!;
    expect(mcq).toMatchObject({ type: 'mcq_single', correctOptionIds: ['A'], explanation: { text: 'All electrons are paired.' } });
    expect(toLiveQuestion(mcq)).toMatchObject({ correctIndex: 0, options: ['Diamagnet moment is zero.', 'Paramagnet moment is zero.', 'Ferromagnet moment is zero.', 'Ferromagnet demagnetises fast.'] });
  });

  it('handles numerical and more-than-one-answer questions, and leaves out what it cannot mark', async () => {
    const all = await bank.sample({ examId: 'JEE' }, 50);
    expect(all).toHaveLength(3); // assertion–reason (shared with NEET), numerical, multi; not the written answer
    const full = await bank.questions(all.map((q) => q.id));
    expect(full.find((q) => q.type === 'numerical')!.numerical).toEqual({ value: 0.5, tolerance: 0.01 });
    expect(full.find((q) => q.type === 'mcq_multi')!.correctOptionIds).toEqual(['A', 'C']);
    expect((await bank.sample({ examId: 'NEET' }, 50)).some((q) => ['Rejected', 'No answer'].includes(q.text))).toBe(false);
  });

  it('keeps a question shared by two exams separate for each, and ignores bad ids', async () => {
    const id = '22222222-2222-4222-8222-222222222222';
    const [neet] = await bank.questions([`NEET~${id}`]);
    const [jee] = await bank.questions([`JEE~${id}`]);
    expect(neet.examId).toBe('NEET');
    expect(jee.examId).toBe('JEE');
    expect(neet.chapterId).not.toBe(jee.chapterId);
    expect(await bank.questions([`KCET~${id}`, 'nonsense', `NEET~not-a-uuid`])).toEqual([]);
  });

  it('narrows to topics and pages through a chapter for staff', async () => {
    const [ch] = await bank.chapters('NEET');
    const topics = await bank.topics(ch.id);
    const bar = topics.find((t) => t.name === 'The Bar Magnet')!;
    const qs = await bank.sample({ examId: 'NEET', parts: [{ chapterId: ch.id, topicIds: [bar.id] }] }, 10);
    expect(qs).toHaveLength(1);
    const page = await bank.browse(ch.id, 1, 2);
    expect(page.total).toBe(3);
    expect(page.items).toHaveLength(2);
  });

  it('reads numbers the way GenPrep writes them', () => {
    expect(parseNumber('$4$')).toBe(4);
    expect(parseNumber('1/4')).toBe(0.25);
    expect(parseNumber(' -0.5 ')).toBe(-0.5);
    expect(parseNumber('sum')).toBeNull();
    expect(parseNumber('$\\frac12$')).toBeNull();
  });

  it('puts in the asked number of questions with pictures, and turns Markdown pictures into {{IMG::}}', async () => {
    for (let n = 0; n < 5; n++) {
      const qs = await bank.sample({ examId: 'KCET', minImages: 2 }, 4);
      expect(qs).toHaveLength(4);
      expect(qs.filter((q) => q.text.includes('{{IMG::')).length).toBe(2);
    }
    const lens = (await bank.sample({ examId: 'KCET', minImages: 2 }, 2)).find((q) => q.text.startsWith('Name the lens'))!;
    expect(lens.text).toBe('Name the lens shown here: {{IMG::https://img.example/lens.jpg}}');
  });
});
