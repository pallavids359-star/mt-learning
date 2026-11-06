import { ObjectId } from 'mongodb';
import { toFull, toQuestion } from './mongo-bank';
import { toLiveQuestion } from './prep.service';

/** A question document exactly as GenPrep's Mongoose model stores it. */
const doc = {
  _id: new ObjectId('65f1a2b3c4d5e6f708192a3b'),
  examId: new ObjectId('65f1a2b3c4d5e6f708192a01'),
  subjectId: new ObjectId('65f1a2b3c4d5e6f708192a02'),
  chapterId: new ObjectId('65f1a2b3c4d5e6f708192a03'),
  topicId: new ObjectId('65f1a2b3c4d5e6f708192a04'),
  type: 'mcq_single',
  text: 'Kinetic energy is $\\frac{1}{2}mv^2$. What is it for $m=2$, $v=3$?',
  images: [{ url: 'https://res.cloudinary.com/x/q.png', publicId: 'q' }],
  options: [
    { id: 'A', text: '9 J' },
    { id: 'B', text: '6 J' },
    { id: 'C', text: '', image: { url: 'https://res.cloudinary.com/x/c.png' } },
    { id: 'D', text: '18 J' },
  ],
  correctOptionIds: ['A'],
  explanation: { text: '$\\frac{1}{2}\\times2\\times9 = 9$', images: [], videoUrl: '' },
  difficulty: 'easy',
  marks: { correct: 4 },
  status: 'published',
  stats: { attempts: 10, correct: 7 },
};

describe('GenPrep question mapping', () => {
  it('reads a question as GenPrep stores it', () => {
    const q = toQuestion(doc);
    expect(q).toMatchObject({
      id: '65f1a2b3c4d5e6f708192a3b',
      examId: '65f1a2b3c4d5e6f708192a01',
      type: 'mcq_single',
      difficulty: 'easy',
      images: ['https://res.cloudinary.com/x/q.png'],
      marks: { correct: 4, incorrect: undefined },
    });
    expect(q.options[2]).toEqual({ id: 'C', text: '', image: 'https://res.cloudinary.com/x/c.png' });
    expect(JSON.stringify(q)).not.toContain('correctOptionIds');
  });

  it('includes answers only in the full form', () => {
    const f = toFull(doc);
    expect(f.correctOptionIds).toEqual(['A']);
    expect(f.status).toBe('published');
    expect(f.explanation.text).toContain('frac');
  });

  it('reads numerical answers and ignores unsafe image links', () => {
    const f = toFull({ ...doc, type: 'numerical', options: [], correctOptionIds: [], numericalAnswer: { value: 9, tolerance: 0.5 }, images: [{ url: 'http://insecure/x.png' }] });
    expect(f.numerical).toEqual({ value: 9, tolerance: 0.5 });
    expect(f.images).toEqual([]);
  });

  it('turns a single-answer question into a live-test question, keeping pictures', () => {
    const live = toLiveQuestion(toFull(doc))!;
    expect(live.correctIndex).toBe(0);
    expect(live.text).toContain('{{IMG::https://res.cloudinary.com/x/q.png}}');
    expect(live.options[2]).toBe('{{IMG::https://res.cloudinary.com/x/c.png}}');
    expect(toLiveQuestion(toFull({ ...doc, type: 'mcq_multi', correctOptionIds: ['A', 'B'] }))).toBeNull();
  });
});
