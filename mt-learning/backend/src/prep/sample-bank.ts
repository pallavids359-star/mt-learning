import {
  type BankChapter,
  type BankExam,
  type BankQuestion,
  type BankSubject,
  type BankTopic,
  type Difficulty,
  type FullQuestion,
  type OptionId,
  type QuestionBank,
  type SampleFilter,
  shuffle,
  studentView,
} from './bank';

/**
 * A small, built-in question bank used when GenPrep's MongoDB is not configured, so the
 * practice, mock-test and live-test features can be tried (and tested) without it.
 * Same shapes and conventions as GenPrep: $maths$, +4/−1 marking for NEET and JEE.
 */

type Q = [
  topic: number,
  difficulty: Difficulty,
  text: string,
  options: [string, string, string, string] | null,
  correct: OptionId[] | number,
  explanation: string,
];
type ChapterDef = { name: string; classLevel: '11' | '12'; topics: string[]; questions: Q[] };

const PHYSICS: ChapterDef[] = [
  {
    name: 'Units and Measurements',
    classLevel: '11',
    topics: ['Dimensions', 'Errors in measurement'],
    questions: [
      [0, 'easy', 'The dimensional formula of force is', ['$[MLT^{-2}]$', '$[ML^2T^{-2}]$', '$[MLT^{-1}]$', '$[M^0LT^{-2}]$'], ['A'], 'Force = mass × acceleration, so $[M][LT^{-2}] = [MLT^{-2}]$.'],
      [0, 'medium', 'Which pair of quantities has the same dimensions?', ['Work and power', 'Torque and work', 'Momentum and impulse per second', 'Pressure and force'], ['B'], 'Torque $= rF$ and work $= Fd$ are both $[ML^2T^{-2}]$.'],
      [1, 'medium', 'A length is measured as $2.50\\,\\text{cm}$ with a least count of $0.01\\,\\text{cm}$. The percentage error is', ['0.2%', '0.4%', '1%', '2.5%'], ['B'], 'Percentage error $= \\frac{0.01}{2.50}\\times 100 = 0.4\\%$.'],
      [1, 'hard', 'If $x = \\frac{a^2}{b}$ and $a$, $b$ have relative errors of 1% and 2%, the relative error in $x$ is', ['3%', '4%', '1%', '5%'], ['B'], 'Relative error $= 2(1\\%) + 2\\% = 4\\%$.'],
    ],
  },
  {
    name: 'Laws of Motion',
    classLevel: '11',
    topics: ["Newton's laws", 'Friction'],
    questions: [
      [0, 'easy', 'A body of mass $2\\,\\text{kg}$ accelerates at $3\\,\\text{m/s}^2$. The net force on it is', ['$1.5\\,\\text{N}$', '$5\\,\\text{N}$', '$6\\,\\text{N}$', '$9\\,\\text{N}$'], ['C'], '$F = ma = 2 \\times 3 = 6\\,\\text{N}$.'],
      [0, 'medium', "Newton's first law of motion defines", ['Momentum', 'Inertia', 'Energy', 'Power'], ['B'], 'The first law describes inertia: a body keeps its state of rest or uniform motion.'],
      [1, 'medium', 'A block on a rough horizontal surface ($\\mu = 0.5$, $m = 4\\,\\text{kg}$, $g = 10\\,\\text{m/s}^2$). The maximum static friction is', ['$10\\,\\text{N}$', '$20\\,\\text{N}$', '$40\\,\\text{N}$', '$2\\,\\text{N}$'], ['B'], '$f = \\mu mg = 0.5 \\times 4 \\times 10 = 20\\,\\text{N}$.'],
      [1, 'hard', 'The angle of repose equals $\\theta$. The coefficient of static friction is', ['$\\sin\\theta$', '$\\cos\\theta$', '$\\tan\\theta$', '$\\cot\\theta$'], ['C'], 'At the angle of repose, $mg\\sin\\theta = \\mu mg\\cos\\theta$, so $\\mu = \\tan\\theta$.'],
    ],
  },
  {
    name: 'Current Electricity',
    classLevel: '12',
    topics: ["Ohm's law", 'Kirchhoff’s laws'],
    questions: [
      [0, 'easy', 'A $10\\,\\Omega$ resistor carries $2\\,\\text{A}$. The potential difference across it is', ['$5\\,\\text{V}$', '$12\\,\\text{V}$', '$20\\,\\text{V}$', '$0.2\\,\\text{V}$'], ['C'], '$V = IR = 2 \\times 10 = 20\\,\\text{V}$.'],
      [0, 'medium', 'Two $6\\,\\Omega$ resistors are connected in parallel. The equivalent resistance is', ['$12\\,\\Omega$', '$3\\,\\Omega$', '$6\\,\\Omega$', '$1.5\\,\\Omega$'], ['B'], '$\\frac{1}{R} = \\frac{1}{6} + \\frac{1}{6}$, so $R = 3\\,\\Omega$.'],
      [1, 'medium', "Kirchhoff's junction rule is a statement of conservation of", ['Energy', 'Charge', 'Momentum', 'Mass'], ['B'], 'Charge entering a junction equals charge leaving it.'],
      [0, 'hard', 'A wire of resistance $R$ is stretched to twice its length (volume constant). The new resistance, in multiples of $R$, is', null, 4, '$R \\propto \\frac{l^2}{V}$, so doubling $l$ gives $4R$.'],
    ],
  },
];

const CHEMISTRY: ChapterDef[] = [
  {
    name: 'Some Basic Concepts of Chemistry',
    classLevel: '11',
    topics: ['Mole concept', 'Stoichiometry'],
    questions: [
      [0, 'easy', 'The number of moles in $36\\,\\text{g}$ of water is', ['1', '2', '3', '0.5'], ['B'], 'Molar mass of $H_2O$ is $18\\,\\text{g/mol}$, so $36/18 = 2$.'],
      [0, 'medium', 'The number of molecules in $0.5$ mol of $CO_2$ is', ['$6.022\\times10^{23}$', '$3.011\\times10^{23}$', '$1.2\\times10^{24}$', '$3.011\\times10^{22}$'], ['B'], '$0.5 \\times 6.022\\times10^{23} = 3.011\\times10^{23}$.'],
      [1, 'medium', 'In $2H_2 + O_2 \\rightarrow 2H_2O$, moles of $O_2$ needed for 4 mol of $H_2$ are', ['1', '2', '4', '8'], ['B'], 'Ratio $H_2 : O_2 = 2 : 1$, so 4 mol $H_2$ needs 2 mol $O_2$.'],
      [1, 'hard', 'The empirical formula of a compound with 40% C, 6.7% H and 53.3% O is', ['$CHO$', '$CH_2O$', '$C_2H_4O$', '$CH_3O$'], ['B'], 'Mole ratio C : H : O = 3.33 : 6.7 : 3.33 = 1 : 2 : 1.'],
    ],
  },
  {
    name: 'Chemical Bonding and Molecular Structure',
    classLevel: '11',
    topics: ['VSEPR theory', 'Hybridisation'],
    questions: [
      [0, 'easy', 'The shape of $CH_4$ is', ['Square planar', 'Tetrahedral', 'Trigonal planar', 'Linear'], ['B'], 'Four bond pairs and no lone pair give a tetrahedral shape.'],
      [0, 'medium', 'The bond angle in $H_2O$ is about', ['$109.5^\\circ$', '$104.5^\\circ$', '$120^\\circ$', '$180^\\circ$'], ['B'], 'Two lone pairs squeeze the bond angle from $109.5^\\circ$ to about $104.5^\\circ$.'],
      [1, 'medium', 'The hybridisation of carbon in $C_2H_2$ is', ['$sp$', '$sp^2$', '$sp^3$', '$sp^3d$'], ['A'], 'Each carbon in ethyne forms a triple bond: $sp$ hybridised.'],
      [1, 'hard', 'Which of these molecules are polar? (Choose all that apply)', ['$NH_3$', '$CO_2$', '$H_2O$', '$CCl_4$'], ['A', 'C'], '$CO_2$ and $CCl_4$ are symmetrical, so their dipoles cancel.'],
    ],
  },
];

const BIOLOGY: ChapterDef[] = [
  {
    name: 'Cell: The Unit of Life',
    classLevel: '11',
    topics: ['Cell organelles', 'Prokaryotic cells'],
    questions: [
      [0, 'easy', 'The powerhouse of the cell is the', ['Ribosome', 'Mitochondrion', 'Golgi body', 'Lysosome'], ['B'], 'Mitochondria make most of the cell’s ATP by aerobic respiration.'],
      [0, 'medium', 'Ribosomes in eukaryotic cytoplasm are of the type', ['70S', '80S', '60S', '50S'], ['B'], 'Eukaryotic cytoplasmic ribosomes are 80S; prokaryotic ones are 70S.'],
      [1, 'medium', 'Which structure is absent in prokaryotic cells?', ['Ribosome', 'Cell membrane', 'Nuclear envelope', 'DNA'], ['C'], 'Prokaryotes have no membrane-bound nucleus.'],
      [0, 'hard', 'The "suicidal bags" of the cell are', ['Lysosomes', 'Vacuoles', 'Peroxisomes', 'Plastids'], ['A'], 'Lysosomes hold hydrolytic enzymes that can digest the cell itself.'],
    ],
  },
  {
    name: 'Human Reproduction',
    classLevel: '12',
    topics: ['Gametogenesis', 'Menstrual cycle'],
    questions: [
      [0, 'easy', 'Spermatogenesis takes place in the', ['Epididymis', 'Seminiferous tubules', 'Vas deferens', 'Prostate'], ['B'], 'Sperm are produced in the seminiferous tubules of the testes.'],
      [0, 'medium', 'The number of chromosomes in a human secondary oocyte is', ['46', '23', '92', '44'], ['B'], 'After meiosis I the secondary oocyte is haploid: 23 chromosomes.'],
      [1, 'medium', 'Ovulation is triggered by a surge of', ['FSH', 'LH', 'Progesterone', 'Prolactin'], ['B'], 'The mid-cycle LH surge causes the Graafian follicle to rupture.'],
      [1, 'hard', 'In a 28-day cycle, ovulation usually occurs on about day', ['1', '7', '14', '28'], ['C'], 'Ovulation happens around the middle of the cycle, about day 14.'],
    ],
  },
];

const MATHS: ChapterDef[] = [
  {
    name: 'Quadratic Equations',
    classLevel: '11',
    topics: ['Roots and coefficients', 'Nature of roots'],
    questions: [
      [0, 'easy', 'The sum of the roots of $x^2 - 5x + 6 = 0$ is', ['5', '-5', '6', '-6'], ['A'], 'Sum of roots $= -\\frac{b}{a} = 5$.'],
      [0, 'medium', 'The roots of $x^2 - 5x + 6 = 0$ are', ['1 and 6', '2 and 3', '-2 and -3', '3 and 4'], ['B'], '$(x-2)(x-3) = 0$.'],
      [1, 'medium', 'For real and equal roots of $x^2 + kx + 9 = 0$, a positive $k$ is', ['3', '6', '9', '18'], ['B'], 'Discriminant $k^2 - 36 = 0$, so $k = 6$.'],
      [0, 'hard', 'If $\\alpha, \\beta$ are roots of $x^2 - 3x + 1 = 0$, the value of $\\alpha^2 + \\beta^2$ is', null, 7, '$\\alpha^2+\\beta^2 = (\\alpha+\\beta)^2 - 2\\alpha\\beta = 9 - 2 = 7$.'],
    ],
  },
  {
    name: 'Limits and Derivatives',
    classLevel: '11',
    topics: ['Limits', 'Derivatives'],
    questions: [
      [0, 'easy', '$\\lim_{x \\to 0} \\frac{\\sin x}{x}$ equals', ['0', '1', '$\\infty$', 'Does not exist'], ['B'], 'A standard limit: $\\lim_{x\\to0} \\frac{\\sin x}{x} = 1$.'],
      [1, 'easy', 'The derivative of $x^3$ is', ['$3x^2$', '$x^2$', '$3x$', '$x^3/3$'], ['A'], 'Power rule: $\\frac{d}{dx}x^n = nx^{n-1}$.'],
      [1, 'medium', 'The derivative of $\\sin x \\cos x$ is', ['$\\cos 2x$', '$\\sin 2x$', '$-\\sin 2x$', '$\\cos^2 x$'], ['A'], '$\\sin x\\cos x = \\frac{1}{2}\\sin 2x$, whose derivative is $\\cos 2x$.'],
      [0, 'hard', '$\\lim_{x \\to 2} \\frac{x^2 - 4}{x - 2}$ equals', ['0', '2', '4', 'Does not exist'], ['C'], 'Factor: $\\frac{(x-2)(x+2)}{x-2} = x + 2 \\to 4$.'],
    ],
  },
];

const EXAMS: { code: string; name: string; minutes: number; marking: BankExam['marking']; subjects: [string, ChapterDef[]][] }[] = [
  { code: 'NEET', name: 'NEET (UG)', minutes: 180, marking: { correct: 4, incorrect: -1, unanswered: 0 }, subjects: [['Physics', PHYSICS], ['Chemistry', CHEMISTRY], ['Biology', BIOLOGY]] },
  { code: 'JEE', name: 'JEE Main', minutes: 180, marking: { correct: 4, incorrect: -1, unanswered: 0 }, subjects: [['Physics', PHYSICS], ['Chemistry', CHEMISTRY], ['Mathematics', MATHS]] },
  { code: 'KCET', name: 'Karnataka CET', minutes: 80, marking: { correct: 1, incorrect: 0, unanswered: 0 }, subjects: [['Physics', PHYSICS], ['Chemistry', CHEMISTRY], ['Mathematics', MATHS], ['Biology', BIOLOGY]] },
];

const OPT: OptionId[] = ['A', 'B', 'C', 'D'];

function build() {
  const exams: BankExam[] = [];
  const subjects: BankSubject[] = [];
  const chapters: BankChapter[] = [];
  const topics: BankTopic[] = [];
  const questions: FullQuestion[] = [];
  for (const e of EXAMS) {
    const examId = `sample-${e.code.toLowerCase()}`;
    exams.push({ id: examId, code: e.code, name: e.name, marking: e.marking, durationMinutes: e.minutes });
    for (const [si, [sName, defs]] of e.subjects.entries()) {
      const subjectId = `${examId}-s${si + 1}`;
      subjects.push({ id: subjectId, examId, name: sName, order: si });
      for (const [ci, ch] of defs.entries()) {
        const chapterId = `${subjectId}-c${ci + 1}`;
        chapters.push({ id: chapterId, examId, subjectId, name: ch.name, classLevel: ch.classLevel, weightage: 0, order: ci, questionCount: ch.questions.length });
        ch.topics.forEach((t, ti) =>
          topics.push({ id: `${chapterId}-t${ti + 1}`, chapterId, name: t, order: ti, questionCount: ch.questions.filter((q) => q[0] === ti).length }),
        );
        ch.questions.forEach(([ti, difficulty, text, options, correct, explanation], qi) => {
          const numerical = typeof correct === 'number';
          const multi = !numerical && correct.length > 1;
          questions.push({
            id: `${chapterId}-q${qi + 1}`,
            examId,
            subjectId,
            chapterId,
            topicId: `${chapterId}-t${ti + 1}`,
            type: numerical ? 'numerical' : multi ? 'mcq_multi' : 'mcq_single',
            text,
            images: [],
            options: options ? options.map((o, i) => ({ id: OPT[i], text: o })) : [],
            difficulty,
            correctOptionIds: numerical ? [] : correct,
            ...(numerical ? { numerical: { value: correct, tolerance: 0 } } : {}),
            explanation: { text: explanation, images: [] },
            status: 'published',
          });
        });
      }
    }
  }
  return { exams, subjects, chapters, topics, questions };
}

export class SampleQuestionBank implements QuestionBank {
  readonly source = 'sample' as const;
  private readonly data = build();

  async exams() {
    return this.data.exams;
  }
  async subjects(examId: string) {
    return this.data.subjects.filter((s) => s.examId === examId);
  }
  async chapters(examId: string) {
    return this.data.chapters.filter((c) => c.examId === examId);
  }
  async topics(chapterId: string) {
    return this.data.topics.filter((t) => t.chapterId === chapterId);
  }
  async topicsByIds(ids: string[]) {
    return this.data.topics.filter((t) => ids.includes(t.id));
  }
  async sample(filter: SampleFilter, size: number): Promise<BankQuestion[]> {
    const parts = filter.parts ?? [];
    const pool = this.data.questions.filter(
      (q) =>
        q.examId === filter.examId &&
        q.status === 'published' &&
        (!filter.subjectId || q.subjectId === filter.subjectId) &&
        (!filter.difficulty || q.difficulty === filter.difficulty) &&
        (!parts.length || parts.some((p) => p.chapterId === q.chapterId && (!p.topicIds?.length || p.topicIds.includes(q.topicId)))),
    );
    return shuffle(pool).slice(0, size).map(studentView);
  }
  async questions(ids: string[]) {
    return this.data.questions.filter((q) => ids.includes(q.id));
  }
  async browse(chapterId: string, page: number, pageSize: number) {
    const all = this.data.questions.filter((q) => q.chapterId === chapterId && q.type === 'mcq_single');
    return { items: all.slice((page - 1) * pageSize, page * pageSize), total: all.length };
  }
}
