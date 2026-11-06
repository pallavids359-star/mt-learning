import { Logger } from '@nestjs/common';
import { type Collection, type Db, type Document, MongoClient, ObjectId } from 'mongodb';
import type {
  BankChapter,
  BankExam,
  BankOption,
  BankQuestion,
  BankSubject,
  BankTopic,
  Difficulty,
  FullQuestion,
  OptionId,
  QuestionBank,
  QuestionType,
  SampleFilter,
} from './bank';

const isId = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{24}$/i.test(v);
const oid = (v: string) => new ObjectId(v);
const str = (v: unknown) => (v == null ? '' : String(v));
const imgUrl = (v: unknown): string | undefined => {
  const url = v && typeof v === 'object' ? (v as { url?: unknown }).url : undefined;
  return typeof url === 'string' && url.startsWith('https://') ? url : undefined;
};
const OPTION_IDS: OptionId[] = ['A', 'B', 'C', 'D'];

/** Only what is needed; answers are fetched separately and never sent to students early. */
const STUDENT_FIELDS = {
  examId: 1,
  subjectId: 1,
  chapterId: 1,
  topicId: 1,
  type: 1,
  text: 1,
  images: 1,
  options: 1,
  difficulty: 1,
  marks: 1,
} as const;

/**
 * Reads GenPrep's question bank directly from its MongoDB. Read-only by design: no method
 * here writes, and the connection should use a MongoDB user with the "read" role only.
 * The syllabus (exams, subjects, chapters, topics) is cached for five minutes.
 */
export class MongoQuestionBank implements QuestionBank {
  readonly source = 'genprep' as const;
  private readonly log = new Logger('GenPrepBank');
  private client: MongoClient;
  private db?: Promise<Db>;
  private cache = new Map<string, { at: number; value: unknown }>();

  constructor(
    private readonly uri: string,
    private readonly dbName?: string,
  ) {
    this.client = new MongoClient(uri, { readPreference: 'secondaryPreferred', maxPoolSize: 10, serverSelectionTimeoutMS: 8000 });
  }

  private database(): Promise<Db> {
    this.db ??= this.client
      .connect()
      .then((c) => {
        this.log.log('Connected to the GenPrep question bank');
        return c.db(this.dbName);
      })
      .catch((e: unknown) => {
        this.db = undefined; // try again on the next request
        throw e;
      });
    return this.db;
  }

  private async col(name: string): Promise<Collection<Document>> {
    return (await this.database()).collection(name);
  }

  private async cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < 5 * 60_000) return hit.value as T;
    const value = await load();
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  // ---------------------------------------------------------------- syllabus

  exams(): Promise<BankExam[]> {
    return this.cached('exams', async () => {
      const rows = await (await this.col('exams')).find({ isActive: { $ne: false } }).sort({ order: 1, code: 1 }).toArray();
      return rows.map((e) => ({
        id: str(e._id),
        code: str(e.code).toUpperCase(),
        name: str(e.name),
        durationMinutes: Number(e.durationMinutes) || 180,
        marking: {
          correct: Number(e.markingScheme?.correct ?? 4),
          incorrect: Number(e.markingScheme?.incorrect ?? -1),
          unanswered: Number(e.markingScheme?.unanswered ?? 0),
        },
      }));
    });
  }

  subjects(examId: string): Promise<BankSubject[]> {
    if (!isId(examId)) return Promise.resolve([]);
    return this.cached(`subjects:${examId}`, async () => {
      const rows = await (await this.col('subjects')).find({ examId: oid(examId), isActive: { $ne: false } }).sort({ order: 1, name: 1 }).toArray();
      return rows.map((s) => ({ id: str(s._id), examId, name: str(s.name), order: Number(s.order) || 0 }));
    });
  }

  chapters(examId: string): Promise<BankChapter[]> {
    if (!isId(examId)) return Promise.resolve([]);
    return this.cached(`chapters:${examId}`, async () => {
      const [rows, counts] = await Promise.all([
        (await this.col('chapters')).find({ examId: oid(examId), isActive: { $ne: false } }).sort({ classLevel: 1, order: 1, name: 1 }).toArray(),
        this.publishedCounts('chapterId', { examId: oid(examId) }),
      ]);
      return rows.map((c) => ({
        id: str(c._id),
        examId,
        subjectId: str(c.subjectId),
        name: str(c.name),
        classLevel: c.classLevel === '11' ? '11' : '12',
        weightage: Number(c.weightage) || 0,
        order: Number(c.order) || 0,
        questionCount: counts.get(str(c._id)) ?? 0,
      }));
    });
  }

  topics(chapterId: string): Promise<BankTopic[]> {
    if (!isId(chapterId)) return Promise.resolve([]);
    return this.cached(`topics:${chapterId}`, async () => {
      const [rows, counts] = await Promise.all([
        (await this.col('topics')).find({ chapterId: oid(chapterId), isActive: { $ne: false } }).sort({ order: 1, name: 1 }).toArray(),
        this.publishedCounts('topicId', { chapterId: oid(chapterId) }),
      ]);
      return rows.map((t) => ({ id: str(t._id), chapterId, name: str(t.name), order: Number(t.order) || 0, questionCount: counts.get(str(t._id)) ?? 0 }));
    });
  }

  async topicsByIds(ids: string[]): Promise<BankTopic[]> {
    const valid = ids.filter(isId);
    if (!valid.length) return [];
    const rows = await (await this.col('topics')).find({ _id: { $in: valid.map(oid) } }).toArray();
    return rows.map((t) => ({ id: str(t._id), chapterId: str(t.chapterId), name: str(t.name), order: Number(t.order) || 0, questionCount: 0 }));
  }

  /** Published question counts grouped by a field, computed from the questions themselves. */
  private async publishedCounts(field: 'chapterId' | 'topicId', match: Document): Promise<Map<string, number>> {
    const rows = await (await this.col('questions'))
      .aggregate<{ _id: unknown; n: number }>([{ $match: { ...match, status: 'published' } }, { $group: { _id: `$${field}`, n: { $sum: 1 } } }])
      .toArray();
    return new Map(rows.map((r) => [str(r._id), r.n]));
  }

  // ---------------------------------------------------------------- questions

  async sample(filter: SampleFilter, size: number): Promise<BankQuestion[]> {
    if (!isId(filter.examId) || size < 1) return [];
    const match: Document = { examId: oid(filter.examId), status: 'published' };
    if (filter.subjectId && isId(filter.subjectId)) match.subjectId = oid(filter.subjectId);
    if (filter.difficulty) match.difficulty = filter.difficulty;
    const parts = (filter.parts ?? []).filter((p) => isId(p.chapterId));
    if (parts.length) {
      match.$or = parts.map((p) => {
        const topics = (p.topicIds ?? []).filter(isId);
        return topics.length ? { chapterId: oid(p.chapterId), topicId: { $in: topics.map(oid) } } : { chapterId: oid(p.chapterId) };
      });
    }
    const rows = await (await this.col('questions')).aggregate([{ $match: match }, { $sample: { size } }, { $project: STUDENT_FIELDS }]).toArray();
    return rows.map((r) => toQuestion(r));
  }

  async questions(ids: string[]): Promise<FullQuestion[]> {
    const valid = [...new Set(ids.filter(isId))];
    if (!valid.length) return [];
    const rows = await (await this.col('questions')).find({ _id: { $in: valid.map(oid) } }).toArray();
    return rows.map((r) => toFull(r));
  }

  async browse(chapterId: string, page: number, pageSize: number): Promise<{ items: FullQuestion[]; total: number }> {
    if (!isId(chapterId)) return { items: [], total: 0 };
    const col = await this.col('questions');
    const match = { chapterId: oid(chapterId), status: 'published', type: 'mcq_single' };
    const [rows, total] = await Promise.all([
      col.find(match).sort({ _id: 1 }).skip((page - 1) * pageSize).limit(pageSize).toArray(),
      col.countDocuments(match),
    ]);
    return { items: rows.map((r) => toFull(r)), total };
  }
}

function toOptions(raw: unknown): BankOption[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((o: Document) => ({ id: str(o.id).toUpperCase() as OptionId, text: str(o.text), image: imgUrl(o.image) }))
    .filter((o) => OPTION_IDS.includes(o.id))
    .map((o) => (o.image ? o : { id: o.id, text: o.text }));
}

export function toQuestion(r: Document): BankQuestion {
  const type: QuestionType = r.type === 'mcq_multi' || r.type === 'numerical' ? r.type : 'mcq_single';
  const difficulty: Difficulty = r.difficulty === 'easy' || r.difficulty === 'hard' ? r.difficulty : 'medium';
  const marks =
    r.marks && (typeof r.marks.correct === 'number' || typeof r.marks.incorrect === 'number')
      ? { correct: typeof r.marks.correct === 'number' ? r.marks.correct : undefined, incorrect: typeof r.marks.incorrect === 'number' ? r.marks.incorrect : undefined }
      : undefined;
  return {
    id: str(r._id),
    examId: str(r.examId),
    subjectId: str(r.subjectId),
    chapterId: str(r.chapterId),
    topicId: str(r.topicId),
    type,
    text: str(r.text),
    images: Array.isArray(r.images) ? (r.images.map(imgUrl).filter(Boolean) as string[]) : [],
    options: toOptions(r.options),
    difficulty,
    ...(marks ? { marks } : {}),
  };
}

export function toFull(r: Document): FullQuestion {
  const q = toQuestion(r);
  const correct = (Array.isArray(r.correctOptionIds) ? r.correctOptionIds : []).map((x: unknown) => str(x).toUpperCase()).filter((x: string) => OPTION_IDS.includes(x as OptionId)) as OptionId[];
  const num = r.numericalAnswer && typeof r.numericalAnswer.value === 'number' ? { value: r.numericalAnswer.value as number, tolerance: Number(r.numericalAnswer.tolerance) || 0 } : undefined;
  return {
    ...q,
    correctOptionIds: [...correct].sort() as OptionId[],
    ...(num ? { numerical: num } : {}),
    explanation: {
      text: str(r.explanation?.text),
      images: Array.isArray(r.explanation?.images) ? (r.explanation.images.map(imgUrl).filter(Boolean) as string[]) : [],
      ...(r.explanation?.videoUrl ? { videoUrl: str(r.explanation.videoUrl) } : {}),
    },
    status: r.status === 'published' || r.status === 'archived' ? r.status : 'draft',
  };
}
