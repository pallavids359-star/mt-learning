import 'package:flutter_test/flutter_test.dart';
import 'package:mt_student/data/prep_models.dart';

void main() {
  group('Marking', () {
    test('labels negative and no-negative marking', () {
      expect(Marking.fromJson({'correct': 4, 'incorrect': -1}).label, '+4 / -1');
      expect(Marking.fromJson({'correct': 1, 'incorrect': 0}).label, '+1, no negative marks');
      expect(Marking.fromJson(null).correct, 4);
    });
  });

  group('attemptOrReview', () {
    test('an attempt in progress keeps saved answers and fills the rest', () {
      final r = attemptOrReview({
        'attemptId': 'a1',
        'mode': 'mock',
        'title': 'NEET Mock Test 1',
        'examCode': 'NEET',
        'marking': {'correct': 4, 'incorrect': -1},
        'remainingSec': 600,
        'questions': [
          {'number': 1, 'id': 'q1', 'type': 'mcq_single', 'text': r'Find $x^2$', 'options': [{'id': 'A', 'text': '1'}, {'id': 'B', 'text': '2'}]},
          {'number': 2, 'id': 'q2', 'type': 'numerical', 'text': 'How many?'},
        ],
        'answers': [
          {'questionId': 'q1', 'selected': ['B'], 'marked': true, 'timeSec': 12},
        ],
      });
      expect(r, isA<InProgress>());
      final a = (r as InProgress).attempt;
      expect(a.isMock, isTrue);
      expect(a.remainingSec, 600);
      expect(a.questions[1].isNumerical, isTrue);
      expect(a.answers['q1']!.selected, ['B']);
      expect(a.answers['q1']!.marked, isTrue);
      expect(a.answers['q2']!.answered, isFalse);
      expect(a.answeredCount, 1);
    });

    test('a finished attempt becomes a review', () {
      final r = attemptOrReview({
        'attemptId': 'a1',
        'mode': 'practice',
        'title': 'Practice',
        'status': 'submitted',
        'submittedAt': '2026-11-06T10:00:00.000Z',
        'result': {'score': 3, 'maxScore': 8, 'correct': 1, 'incorrect': 1, 'unanswered': 0, 'subjects': [{'name': 'Physics', 'score': 3}]},
        'review': [
          {
            'number': 1,
            'questionId': 'q1',
            'text': 'x',
            'selected': ['A'],
            'correctOptionIds': ['A'],
            'isCorrect': true,
            'marksAwarded': 4,
            'explanation': {'text': 'Because.'},
            'bookmarked': true,
          },
          {'number': 2, 'questionId': 'q2', 'type': 'numerical', 'numerical': 3, 'numericalAnswer': 4, 'isCorrect': false, 'marksAwarded': -1},
        ],
      });
      expect(r, isA<Finished>());
      final rv = (r as Finished).review;
      expect(rv.result.score, 3);
      expect(rv.result.subjects.single.name, 'Physics');
      expect(rv.items.first.explanation, 'Because.');
      expect(rv.items.first.bookmarked, isTrue);
      expect(rv.items[1].numericalAnswer, 4);
      expect(rv.items[1].isCorrect, isFalse);
    });
  });

  test('PrepAnswer only sends a numerical value when there is one', () {
    final a = PrepAnswer(questionId: 'q1', selected: ['A', 'C'], timeSec: 5);
    expect(a.toJson().containsKey('numerical'), isFalse);
    a.numerical = 2.5;
    expect(a.toJson()['numerical'], 2.5);
  });

  test('PrepDashboard reads the server field names', () {
    final d = PrepDashboard.fromJson({
      'totals': {'attempted': 20, 'correct': 15, 'accuracy': 75},
      'streak': {'current': 3, 'longest': 5},
      'weakChapters': [{'id': 'c1', 'name': 'Optics', 'subject': 'Physics', 'attempted': 6, 'correct': 2, 'accuracy': 33}],
      'strongChapters': [],
      'last7Days': [{'date': '2026-11-06', 'attempted': 20, 'correct': 15}],
      'wrongQuestionsCount': 5,
      'bookmarksCount': 2,
      'inProgress': {'attemptId': 'a9', 'mode': 'mock', 'title': 'NEET Mock Test 2', 'remainingSec': 300},
      'recent': [],
    });
    expect(d.totals.accuracy, 75);
    expect(d.streak, 3);
    expect(d.weak.single.name, 'Optics');
    expect(d.wrongCount, 5);
    expect(d.inProgress!.attemptId, 'a9');
    expect(d.inProgress!.remainingSec, 300);
  });

  test('missing fields fall back instead of crashing', () {
    final d = PrepDashboard.fromJson(const {});
    expect(d.totals.attempted, 0);
    expect(d.inProgress, isNull);
    expect(MockRow.fromJson(const {}).inProgress, isFalse);
  });
}
