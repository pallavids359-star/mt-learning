/// GenPrep-style practice: exams, syllabus, attempts, results, dashboard and analytics.
/// Parsing is forgiving: a missing field gives a sensible default instead of a crash.
library;

String _s(Object? v, [String fallback = '']) => v is String ? v : (v == null ? fallback : v.toString());
int _i(Object? v, [int fallback = 0]) => v is num ? v.toInt() : fallback;
double _d(Object? v, [double fallback = 0]) => v is num ? v.toDouble() : fallback;
double? _dn(Object? v) => v is num ? v.toDouble() : null;
DateTime? _t(Object? v) => v is String ? DateTime.tryParse(v)?.toLocal() : null;
List<Map<String, dynamic>> _list(Object? v) => v is List ? v.whereType<Map<String, dynamic>>().toList() : const [];
List<String> _strings(Object? v) => v is List ? v.map((e) => e.toString()).toList() : const [];

class Marking {
  const Marking({required this.correct, required this.incorrect});
  final double correct;
  final double incorrect;

  factory Marking.fromJson(Object? raw) {
    final m = raw is Map<String, dynamic> ? raw : const <String, dynamic>{};
    return Marking(correct: _d(m['correct'], 4), incorrect: _d(m['incorrect'], -1));
  }

  String get label {
    String n(double v) => v % 1 == 0 ? v.toInt().toString() : v.toString();
    return incorrect == 0 ? '+${n(correct)}, no negative marks' : '+${n(correct)} / ${n(incorrect)}';
  }
}

class PrepExam {
  const PrepExam({required this.id, required this.code, required this.name, required this.durationMinutes, required this.marking});
  final String id;
  final String code;
  final String name;
  final int durationMinutes;
  final Marking marking;

  factory PrepExam.fromJson(Map<String, dynamic> j) =>
      PrepExam(id: _s(j['id']), code: _s(j['code']), name: _s(j['name']), durationMinutes: _i(j['durationMinutes'], 180), marking: Marking.fromJson(j['marking']));
}

class PrepExams {
  const PrepExams({required this.exams, required this.targetExamId, required this.source});
  final List<PrepExam> exams;
  final String? targetExamId;
  final String source; // genprep | sample

  PrepExam? get target => exams.where((e) => e.id == targetExamId).firstOrNull;

  factory PrepExams.fromJson(Map<String, dynamic> j) => PrepExams(
        exams: _list(j['exams']).map(PrepExam.fromJson).toList(),
        targetExamId: j['targetExamId'] as String?,
        source: _s(j['source'], 'genprep'),
      );
}

class SyllabusChapter {
  const SyllabusChapter({required this.id, required this.name, required this.classLevel, required this.questionCount, required this.attempted, this.accuracy});
  final String id;
  final String name;
  final String classLevel;
  final int questionCount;
  final int attempted;
  final int? accuracy;

  factory SyllabusChapter.fromJson(Map<String, dynamic> j) => SyllabusChapter(
        id: _s(j['id']),
        name: _s(j['name']),
        classLevel: _s(j['classLevel'], '12'),
        questionCount: _i(j['questionCount']),
        attempted: _i(j['attempted']),
        accuracy: j['accuracy'] is num ? (j['accuracy'] as num).round() : null,
      );
}

class SyllabusSubject {
  const SyllabusSubject({required this.id, required this.name, required this.questionCount, required this.chapters});
  final String id;
  final String name;
  final int questionCount;
  final List<SyllabusChapter> chapters;

  factory SyllabusSubject.fromJson(Map<String, dynamic> j) =>
      SyllabusSubject(id: _s(j['id']), name: _s(j['name']), questionCount: _i(j['questionCount']), chapters: _list(j['chapters']).map(SyllabusChapter.fromJson).toList());
}

class PrepTopic {
  const PrepTopic({required this.id, required this.name, required this.questionCount});
  final String id;
  final String name;
  final int questionCount;
  factory PrepTopic.fromJson(Map<String, dynamic> j) => PrepTopic(id: _s(j['id']), name: _s(j['name']), questionCount: _i(j['questionCount']));
}

class PrepOption {
  const PrepOption({required this.id, required this.text, this.image});
  final String id; // A–D
  final String text;
  final String? image;
  factory PrepOption.fromJson(Map<String, dynamic> j) => PrepOption(id: _s(j['id']), text: _s(j['text']), image: j['image'] as String?);
}

/// A question as shown while answering (no answers).
class PrepQuestion {
  const PrepQuestion({
    required this.number,
    required this.id,
    required this.type,
    required this.text,
    required this.images,
    required this.options,
    required this.difficulty,
    required this.subjectName,
    required this.chapterName,
  });
  final int number;
  final String id;
  final String type; // mcq_single | mcq_multi | numerical
  final String text;
  final List<String> images;
  final List<PrepOption> options;
  final String difficulty;
  final String subjectName;
  final String chapterName;

  bool get isMulti => type == 'mcq_multi';
  bool get isNumerical => type == 'numerical';

  factory PrepQuestion.fromJson(Map<String, dynamic> j) => PrepQuestion(
        number: _i(j['number'], 1),
        id: _s(j['id']),
        type: _s(j['type'], 'mcq_single'),
        text: _s(j['text']),
        images: _strings(j['images']),
        options: _list(j['options']).map(PrepOption.fromJson).toList(),
        difficulty: _s(j['difficulty'], 'medium'),
        subjectName: _s(j['subjectName']),
        chapterName: _s(j['chapterName']),
      );
}

/// The student's answer to one question, as kept on the tablet and autosaved.
class PrepAnswer {
  PrepAnswer({required this.questionId, List<String>? selected, this.numerical, this.marked = false, this.timeSec = 0}) : selected = selected ?? [];
  final String questionId;
  List<String> selected;
  double? numerical;
  bool marked;
  int timeSec;

  bool get answered => selected.isNotEmpty || numerical != null;

  Map<String, Object?> toJson() => {
        'questionId': questionId,
        'selected': selected,
        if (numerical != null) 'numerical': numerical,
        'marked': marked,
        'timeSec': timeSec,
      };

  factory PrepAnswer.fromJson(Map<String, dynamic> j) =>
      PrepAnswer(questionId: _s(j['questionId']), selected: _strings(j['selected']), numerical: _dn(j['numerical']), marked: j['marked'] == true, timeSec: _i(j['timeSec']));
}

/// An attempt being taken: practice, mock test or revision.
class PrepAttempt {
  PrepAttempt({
    required this.attemptId,
    required this.mode,
    required this.title,
    required this.examCode,
    required this.marking,
    required this.remainingSec,
    required this.questions,
    required this.answers,
  });
  final String attemptId;
  final String mode; // practice | mock | wrong | bookmark
  final String title;
  final String examCode;
  final Marking marking;
  final int? remainingSec; // null = untimed
  final List<PrepQuestion> questions;
  final Map<String, PrepAnswer> answers;

  bool get isMock => mode == 'mock';
  int get answeredCount => answers.values.where((a) => a.answered).length;

  factory PrepAttempt.fromJson(Map<String, dynamic> j) {
    final questions = _list(j['questions']).map(PrepQuestion.fromJson).toList();
    final saved = {for (final a in _list(j['answers']).map(PrepAnswer.fromJson)) a.questionId: a};
    return PrepAttempt(
      attemptId: _s(j['attemptId']),
      mode: _s(j['mode'], 'practice'),
      title: _s(j['title']),
      examCode: _s(j['examCode']),
      marking: Marking.fromJson(j['marking']),
      remainingSec: j['remainingSec'] is num ? (j['remainingSec'] as num).toInt() : null,
      questions: questions,
      answers: {for (final q in questions) q.id: saved[q.id] ?? PrepAnswer(questionId: q.id)},
    );
  }
}

class SubjectScore {
  const SubjectScore({required this.name, required this.score, required this.correct, required this.incorrect, required this.unanswered});
  final String name;
  final double score;
  final int correct;
  final int incorrect;
  final int unanswered;
  factory SubjectScore.fromJson(Map<String, dynamic> j) =>
      SubjectScore(name: _s(j['name']), score: _d(j['score']), correct: _i(j['correct']), incorrect: _i(j['incorrect']), unanswered: _i(j['unanswered']));
}

class PrepResult {
  const PrepResult({
    required this.score,
    required this.maxScore,
    required this.percentage,
    required this.accuracy,
    required this.correct,
    required this.incorrect,
    required this.unanswered,
    required this.timeTakenSec,
    required this.subjects,
  });
  final double score;
  final double maxScore;
  final double percentage;
  final double accuracy;
  final int correct;
  final int incorrect;
  final int unanswered;
  final int timeTakenSec;
  final List<SubjectScore> subjects;

  factory PrepResult.fromJson(Object? raw) {
    final j = raw is Map<String, dynamic> ? raw : const <String, dynamic>{};
    return PrepResult(
      score: _d(j['score']),
      maxScore: _d(j['maxScore']),
      percentage: _d(j['percentage']),
      accuracy: _d(j['accuracy']),
      correct: _i(j['correct']),
      incorrect: _i(j['incorrect']),
      unanswered: _i(j['unanswered']),
      timeTakenSec: _i(j['timeTakenSec']),
      subjects: _list(j['subjects']).map(SubjectScore.fromJson).toList(),
    );
  }
}

class ReviewItem {
  ReviewItem({
    required this.number,
    required this.questionId,
    required this.type,
    required this.text,
    required this.images,
    required this.options,
    required this.subjectName,
    required this.chapterName,
    required this.selected,
    required this.numerical,
    required this.correctOptionIds,
    required this.numericalAnswer,
    required this.isCorrect,
    required this.marksAwarded,
    required this.timeSec,
    required this.explanation,
    required this.explanationImages,
    required this.bookmarked,
  });
  final int number;
  final String questionId;
  final String type;
  final String text;
  final List<String> images;
  final List<PrepOption> options;
  final String subjectName;
  final String chapterName;
  final List<String> selected;
  final double? numerical;
  final List<String> correctOptionIds;
  final double? numericalAnswer;
  final bool? isCorrect; // null = not answered
  final double marksAwarded;
  final int timeSec;
  final String explanation;
  final List<String> explanationImages;
  bool bookmarked;

  factory ReviewItem.fromJson(Map<String, dynamic> j) {
    final ex = j['explanation'] is Map<String, dynamic> ? j['explanation'] as Map<String, dynamic> : const <String, dynamic>{};
    return ReviewItem(
      number: _i(j['number'], 1),
      questionId: _s(j['questionId']),
      type: _s(j['type'], 'mcq_single'),
      text: _s(j['text']),
      images: _strings(j['images']),
      options: _list(j['options']).map(PrepOption.fromJson).toList(),
      subjectName: _s(j['subjectName']),
      chapterName: _s(j['chapterName']),
      selected: _strings(j['selected']),
      numerical: _dn(j['numerical']),
      correctOptionIds: _strings(j['correctOptionIds']),
      numericalAnswer: _dn(j['numericalAnswer']),
      isCorrect: j['isCorrect'] is bool ? j['isCorrect'] as bool : null,
      marksAwarded: _d(j['marksAwarded']),
      timeSec: _i(j['timeSec']),
      explanation: _s(ex['text']),
      explanationImages: _strings(ex['images']),
      bookmarked: j['bookmarked'] == true,
    );
  }
}

class PrepReview {
  const PrepReview({required this.attemptId, required this.mode, required this.title, required this.status, required this.submittedAt, required this.result, required this.items, this.message});
  final String attemptId;
  final String mode;
  final String title;
  final String status; // submitted | auto_submitted
  final DateTime? submittedAt;
  final PrepResult result;
  final List<ReviewItem> items;
  final String? message;

  factory PrepReview.fromJson(Map<String, dynamic> j) => PrepReview(
        attemptId: _s(j['attemptId']),
        mode: _s(j['mode'], 'practice'),
        title: _s(j['title']),
        status: _s(j['status'], 'submitted'),
        submittedAt: _t(j['submittedAt']),
        result: PrepResult.fromJson(j['result']),
        items: _list(j['review']).map(ReviewItem.fromJson).toList(),
        message: j['message'] as String?,
      );
}

/// GET /me/prep/attempts/:id answers with either an attempt in progress or a review.
sealed class AttemptOrReview {}

class InProgress extends AttemptOrReview {
  InProgress(this.attempt);
  final PrepAttempt attempt;
}

class Finished extends AttemptOrReview {
  Finished(this.review);
  final PrepReview review;
}

AttemptOrReview attemptOrReview(Map<String, dynamic> j) => j['review'] is List ? Finished(PrepReview.fromJson(j)) : InProgress(PrepAttempt.fromJson(j));

class ChapterStat {
  const ChapterStat({required this.id, required this.name, required this.subject, required this.attempted, required this.correct, required this.accuracy});
  final String id;
  final String name;
  final String subject;
  final int attempted;
  final int correct;
  final int accuracy;
  factory ChapterStat.fromJson(Map<String, dynamic> j) =>
      ChapterStat(id: _s(j['id']), name: _s(j['name']), subject: _s(j['subject']), attempted: _i(j['attempted']), correct: _i(j['correct']), accuracy: _i(j['accuracy']));
}

class DayCount {
  const DayCount({required this.date, required this.attempted, required this.correct});
  final String date;
  final int attempted;
  final int correct;
  factory DayCount.fromJson(Map<String, dynamic> j) => DayCount(date: _s(j['date']), attempted: _i(j['attempted']), correct: _i(j['correct']));
}

class HistoryItem {
  const HistoryItem({
    required this.attemptId,
    required this.mode,
    required this.modeLabel,
    required this.title,
    required this.submittedAt,
    required this.questions,
    required this.score,
    required this.maxScore,
    required this.accuracy,
  });
  final String attemptId;
  final String mode;
  final String modeLabel;
  final String title;
  final DateTime? submittedAt;
  final int questions;
  final double score;
  final double maxScore;
  final double accuracy;
  factory HistoryItem.fromJson(Map<String, dynamic> j) => HistoryItem(
        attemptId: _s(j['attemptId']),
        mode: _s(j['mode']),
        modeLabel: _s(j['modeLabel']),
        title: _s(j['title']),
        submittedAt: _t(j['submittedAt']),
        questions: _i(j['questions']),
        score: _d(j['score']),
        maxScore: _d(j['maxScore']),
        accuracy: _d(j['accuracy']),
      );
}

class PrepTotals {
  const PrepTotals({required this.attempted, required this.correct, required this.accuracy, required this.timeSec, required this.testsTaken, this.practiceSessions = 0, this.mocksTaken = 0});
  final int attempted;
  final int correct;
  final int accuracy;
  final int timeSec;
  final int testsTaken;
  final int practiceSessions;
  final int mocksTaken;
  factory PrepTotals.fromJson(Object? raw) {
    final j = raw is Map<String, dynamic> ? raw : const <String, dynamic>{};
    return PrepTotals(
      attempted: _i(j['attempted']),
      correct: _i(j['correct']),
      accuracy: _i(j['accuracy']),
      timeSec: _i(j['timeSec']),
      testsTaken: _i(j['testsTaken']),
      practiceSessions: _i(j['practiceSessions']),
      mocksTaken: _i(j['mocksTaken']),
    );
  }
}

class PrepDashboard {
  const PrepDashboard({
    required this.totals,
    required this.streak,
    required this.longestStreak,
    required this.subjects,
    required this.weak,
    required this.strong,
    required this.last7Days,
    required this.wrongCount,
    required this.bookmarksCount,
    required this.inProgress,
    required this.recent,
  });
  final PrepTotals totals;
  final int streak;
  final int longestStreak;
  final List<ChapterStat> subjects;
  final List<ChapterStat> weak;
  final List<ChapterStat> strong;
  final List<DayCount> last7Days;
  final int wrongCount;
  final int bookmarksCount;
  final ({String attemptId, String mode, String title, int? remainingSec})? inProgress;
  final List<HistoryItem> recent;

  factory PrepDashboard.fromJson(Map<String, dynamic> j) {
    final st = j['streak'] is Map<String, dynamic> ? j['streak'] as Map<String, dynamic> : const <String, dynamic>{};
    final ip = j['inProgress'] is Map<String, dynamic> ? j['inProgress'] as Map<String, dynamic> : null;
    return PrepDashboard(
      totals: PrepTotals.fromJson(j['totals']),
      streak: _i(st['current']),
      longestStreak: _i(st['longest']),
      subjects: _list(j['subjects']).map(ChapterStat.fromJson).toList(),
      weak: _list(j['weakChapters']).map(ChapterStat.fromJson).toList(),
      strong: _list(j['strongChapters']).map(ChapterStat.fromJson).toList(),
      last7Days: _list(j['last7Days']).map(DayCount.fromJson).toList(),
      wrongCount: _i(j['wrongQuestionsCount']),
      bookmarksCount: _i(j['bookmarksCount']),
      inProgress: ip == null ? null : (attemptId: _s(ip['attemptId']), mode: _s(ip['mode']), title: _s(ip['title']), remainingSec: ip['remainingSec'] is num ? (ip['remainingSec'] as num).toInt() : null),
      recent: _list(j['recent']).map(HistoryItem.fromJson).toList(),
    );
  }
}

class MockScore {
  const MockScore({required this.id, required this.title, required this.date, required this.score, required this.maxScore, required this.percentage});
  final String id;
  final String title;
  final DateTime? date;
  final double score;
  final double maxScore;
  final int percentage;
  factory MockScore.fromJson(Map<String, dynamic> j) =>
      MockScore(id: _s(j['id']), title: _s(j['title']), date: _t(j['date']), score: _d(j['score']), maxScore: _d(j['maxScore']), percentage: _i(j['percentage']));
}

class PrepAnalytics {
  const PrepAnalytics({required this.totals, required this.subjects, required this.chapters, required this.mocks, required this.daily});
  final PrepTotals totals;
  final List<ChapterStat> subjects;
  final List<ChapterStat> chapters;
  final List<MockScore> mocks;
  final List<DayCount> daily;
  factory PrepAnalytics.fromJson(Map<String, dynamic> j) => PrepAnalytics(
        totals: PrepTotals.fromJson(j['totals']),
        subjects: _list(j['subjects']).map(ChapterStat.fromJson).toList(),
        chapters: _list(j['chapters']).map(ChapterStat.fromJson).toList(),
        mocks: _list(j['mocks']).map(MockScore.fromJson).toList(),
        daily: _list(j['daily']).map(DayCount.fromJson).toList(),
      );
}

class MockRow {
  const MockRow({required this.attemptId, required this.title, required this.status, required this.startedAt, required this.remainingSec, required this.questions, this.score, this.maxScore, this.percentage});
  final String attemptId;
  final String title;
  final String status; // in_progress | submitted | auto_submitted | expired
  final DateTime? startedAt;
  final int? remainingSec;
  final int questions;
  final double? score;
  final double? maxScore;
  final double? percentage;
  bool get inProgress => status == 'in_progress';
  factory MockRow.fromJson(Map<String, dynamic> j) => MockRow(
        attemptId: _s(j['attemptId']),
        title: _s(j['title']),
        status: _s(j['status']),
        startedAt: _t(j['startedAt']),
        remainingSec: j['remainingSec'] is num ? (j['remainingSec'] as num).toInt() : null,
        questions: _i(j['questions']),
        score: _dn(j['score']),
        maxScore: _dn(j['maxScore']),
        percentage: _dn(j['percentage']),
      );
}

class BookmarkItem {
  const BookmarkItem({required this.questionId, required this.text, required this.subjectName, required this.chapterName});
  final String questionId;
  final String text;
  final String subjectName;
  final String chapterName;
  factory BookmarkItem.fromJson(Map<String, dynamic> j) =>
      BookmarkItem(questionId: _s(j['questionId']), text: _s(j['text']), subjectName: _s(j['subjectName']), chapterName: _s(j['chapterName']));
}
