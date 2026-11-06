/// Data returned by the API. Parsing is defensive: unknown or missing optional
/// fields never crash the app, because cached data may come from an older version.
library;

String _s(Object? v, [String fallback = '']) => v is String ? v : (v == null ? fallback : v.toString());
String? _sn(Object? v) => v is String && v.isNotEmpty ? v : null;
bool _b(Object? v) => v == true;
int _i(Object? v, [int fallback = 0]) => v is num ? v.toInt() : fallback;
int? _in(Object? v) => v is num ? v.toInt() : null;
double? _dn(Object? v) => v is num ? v.toDouble() : null;
double _d(Object? v, [double fallback = 0]) => v is num ? v.toDouble() : fallback;
DateTime? _dt(Object? v) => v is String ? DateTime.tryParse(v)?.toLocal() : null;
Map<String, dynamic> _m(Object? v) => v is Map<String, dynamic> ? v : const {};
List<Map<String, dynamic>> _l(Object? v) => v is List ? v.whereType<Map<String, dynamic>>().toList() : const [];
List<String> _ls(Object? v) => v is List ? v.whereType<String>().toList() : const [];

// ---------------------------------------------------------------- profile & home

class StudentProfile {
  const StudentProfile({
    required this.id,
    required this.studentCode,
    required this.fullName,
    required this.rollNumber,
    required this.className,
    required this.pucYear,
    required this.stream,
    required this.sectionName,
    required this.academicYear,
    required this.hasPhoto,
    required this.mustChangePassword,
    required this.hasPin,
    this.dateOfBirth,
    this.hostelName,
    this.roomNumber,
    this.tabletSerial,
    this.tabletModel,
    this.guardianName,
  });

  final String id;
  final String studentCode;
  final String fullName;
  final String rollNumber;
  final String className;
  final String pucYear;
  final String stream;
  final String sectionName;
  final String academicYear;
  final bool hasPhoto;
  final bool mustChangePassword;
  final bool hasPin;
  final String? dateOfBirth;
  final String? hostelName;
  final String? roomNumber;
  final String? tabletSerial;
  final String? tabletModel;
  final String? guardianName;

  String get pucLabel => pucYear == 'PUC_2' ? '2nd PUC' : '1st PUC';
  String get firstName => fullName.trim().split(RegExp(r'\s+')).first;

  factory StudentProfile.fromJson(Map<String, dynamic> j) {
    final cls = _m(j['classGroup']);
    final hostel = j['hostel'] is Map<String, dynamic> ? j['hostel'] as Map<String, dynamic> : null;
    final tablet = j['tablet'] is Map<String, dynamic> ? j['tablet'] as Map<String, dynamic> : null;
    return StudentProfile(
      id: _s(j['id']),
      studentCode: _s(j['studentCode']),
      fullName: _s(j['fullName'], 'Student'),
      rollNumber: _s(j['rollNumber']),
      className: _s(cls['name']),
      pucYear: _s(cls['pucYear'], 'PUC_1'),
      stream: _s(cls['stream']),
      sectionName: _s(_m(j['section'])['name']),
      academicYear: _s(_m(j['academicYear'])['name']),
      hasPhoto: _b(j['hasPhoto']),
      mustChangePassword: _b(j['mustChangePassword']),
      hasPin: _b(j['hasPin']),
      dateOfBirth: _sn(j['dateOfBirth']),
      hostelName: hostel == null ? null : _sn(hostel['name']),
      roomNumber: hostel == null ? null : _sn(hostel['roomNumber']),
      tabletSerial: tablet == null ? null : _sn(tablet['serialNumber']),
      tabletModel: tablet == null ? null : _sn(tablet['model']),
      guardianName: _sn(j['guardianName']),
    );
  }
}

class SubjectProgress {
  const SubjectProgress({
    required this.id,
    required this.code,
    required this.name,
    required this.teacherNames,
    required this.materialsTotal,
    required this.materialsCompleted,
    this.progressPercent,
  });
  final String id;
  final String code;
  final String name;
  final List<String> teacherNames;
  final int materialsTotal;
  final int materialsCompleted;
  final int? progressPercent;

  factory SubjectProgress.fromJson(Map<String, dynamic> j) => SubjectProgress(
        id: _s(j['id']),
        code: _s(j['code']),
        name: _s(j['name']),
        teacherNames: _ls(j['teacherNames']),
        materialsTotal: _i(j['materialsTotal']),
        materialsCompleted: _i(j['materialsCompleted']),
        progressPercent: _in(j['progressPercent']),
      );
}

class Period {
  const Period({
    required this.startTime,
    required this.endTime,
    required this.subjectCode,
    required this.subjectName,
    required this.status,
    this.teacherName,
    this.topic,
    this.room,
    this.liveId,
    this.liveJoinOpen = false,
  });
  final String startTime;
  final String endTime;
  final String subjectCode;
  final String subjectName;
  final String status; // done | now | later
  final String? teacherName;
  final String? topic;
  final String? room;
  final String? liveId;
  final bool liveJoinOpen;

  factory Period.fromJson(Map<String, dynamic> j) {
    final live = j['live'] is Map<String, dynamic> ? j['live'] as Map<String, dynamic> : null;
    return Period(
      startTime: _s(j['startTime']),
      endTime: _s(j['endTime']),
      subjectCode: _s(j['subjectCode']),
      subjectName: _s(j['subjectName']),
      status: _s(j['status'], 'later'),
      teacherName: _sn(j['teacherName']),
      topic: _sn(j['topic']),
      room: _sn(j['room']),
      liveId: live == null ? null : _sn(live['id']),
      liveJoinOpen: live != null && _b(live['joinOpen']),
    );
  }
}

class AttemptInfo {
  const AttemptInfo({required this.status, required this.reviewStatus, required this.reviewAvailable, this.submittedAt, this.score, this.maxScore, this.percent});
  final String status; // IN_PROGRESS | SUBMITTED
  final String reviewStatus; // NONE | PENDING | ACCEPTED | REJECTED
  final bool reviewAvailable;
  final DateTime? submittedAt;
  final double? score;
  final double? maxScore;
  final double? percent;
  bool get submitted => status == 'SUBMITTED';

  factory AttemptInfo.fromJson(Map<String, dynamic> j) => AttemptInfo(
        status: _s(j['status'], 'IN_PROGRESS'),
        reviewStatus: _s(j['reviewStatus'], 'NONE'),
        reviewAvailable: _b(j['reviewAvailable']),
        submittedAt: _dt(j['submittedAt']),
        score: _dn(j['score']),
        maxScore: _dn(j['maxScore']),
        percent: _dn(j['percent']),
      );
}

class TestInfo {
  const TestInfo({
    required this.id,
    required this.title,
    required this.subjectCode,
    required this.subjectName,
    required this.questionCount,
    required this.durationMin,
    required this.opensAt,
    required this.closesAt,
    required this.allowOffline,
    required this.negativeMarks,
    required this.state,
    this.instructions,
    this.attempt,
    this.serverCanStart,
  });
  final String id;
  final String title;
  final String subjectCode;
  final String subjectName;
  final int questionCount;
  final int durationMin;
  final DateTime opensAt;
  final DateTime closesAt;
  final bool allowOffline;
  final double negativeMarks;
  final String state; // upcoming | open | closed
  final String? instructions;
  final AttemptInfo? attempt;

  /// From the server, which also allows a test reopened ("revived") by staff after it closed.
  final bool? serverCanStart;

  bool get canStart => serverCanStart ?? (state == 'open' && !(attempt?.submitted ?? false));

  factory TestInfo.fromJson(Map<String, dynamic> j) => TestInfo(
        id: _s(j['id']),
        title: _s(j['title']),
        subjectCode: _s(j['subjectCode']),
        subjectName: _s(j['subjectName']),
        questionCount: _i(j['questionCount']),
        durationMin: _i(j['durationMin'], 30),
        opensAt: _dt(j['opensAt']) ?? DateTime.now(),
        closesAt: _dt(j['closesAt']) ?? DateTime.now(),
        allowOffline: _b(j['allowOffline']),
        negativeMarks: _d(j['negativeMarks']),
        state: _s(j['state'], 'closed'),
        instructions: _sn(j['instructions']),
        attempt: j['attempt'] is Map<String, dynamic> ? AttemptInfo.fromJson(j['attempt'] as Map<String, dynamic>) : null,
        serverCanStart: j['canStart'] is bool ? j['canStart'] as bool : null,
      );
}

class NoticeItem {
  const NoticeItem({required this.id, required this.title, required this.body, required this.category, required this.postedByLabel, required this.publishedAt, this.readAt});
  final String id;
  final String title;
  final String body;
  final String category;
  final String postedByLabel;
  final DateTime publishedAt;
  final DateTime? readAt;
  bool get unread => readAt == null;

  NoticeItem markRead() => NoticeItem(id: id, title: title, body: body, category: category, postedByLabel: postedByLabel, publishedAt: publishedAt, readAt: DateTime.now());

  factory NoticeItem.fromJson(Map<String, dynamic> j) => NoticeItem(
        id: _s(j['id']),
        title: _s(j['title']),
        body: _s(j['body']),
        category: _s(j['category'], 'GENERAL'),
        postedByLabel: _s(j['postedByLabel']),
        publishedAt: _dt(j['publishedAt']) ?? DateTime.now(),
        readAt: _dt(j['readAt']),
      );
}

class LiveItem {
  const LiveItem({
    required this.id,
    required this.title,
    required this.subjectCode,
    required this.subjectName,
    required this.startsAt,
    required this.endsAt,
    required this.state,
    required this.joinOpen,
    this.teacherName,
    this.joinUrl,
  });
  final String id;
  final String title;
  final String subjectCode;
  final String subjectName;
  final DateTime startsAt;
  final DateTime endsAt;
  final String state; // scheduled | live | ended | cancelled
  final bool joinOpen;
  final String? teacherName;
  final String? joinUrl;

  factory LiveItem.fromJson(Map<String, dynamic> j) => LiveItem(
        id: _s(j['id']),
        title: _s(j['title']),
        subjectCode: _s(j['subjectCode']),
        subjectName: _s(j['subjectName']),
        startsAt: _dt(j['startsAt']) ?? DateTime.now(),
        endsAt: _dt(j['endsAt']) ?? DateTime.now(),
        state: _s(j['state'], 'scheduled'),
        joinOpen: _b(j['joinOpen']),
        teacherName: _sn(j['teacherName']),
        joinUrl: _sn(j['joinUrl']),
      );
}

class HomeData {
  const HomeData({
    required this.serverTime,
    required this.profile,
    required this.subjects,
    required this.todayDate,
    required this.periods,
    required this.liveNow,
    required this.openTestsCount,
    required this.unreadNotices,
    required this.latestNotices,
    required this.testsTaken,
    required this.studyTotal,
    required this.studyCompleted,
    this.holiday,
    this.nextTest,
    this.attendanceMonth,
    this.attendanceYear,
    this.averagePercent,
  });
  final DateTime serverTime;
  final StudentProfile profile;
  final List<SubjectProgress> subjects;
  final String todayDate;
  final List<Period> periods;
  final List<LiveItem> liveNow;
  final int openTestsCount;
  final int unreadNotices;
  final List<NoticeItem> latestNotices;
  final int testsTaken;
  final int studyTotal;
  final int studyCompleted;
  final String? holiday;
  final TestInfo? nextTest;
  final double? attendanceMonth;
  final double? attendanceYear;
  final double? averagePercent;

  factory HomeData.fromJson(Map<String, dynamic> j) {
    final today = _m(j['today']);
    final notices = _m(j['notices']);
    final att = _m(j['attendance']);
    final res = _m(j['results']);
    final study = _m(j['study']);
    return HomeData(
      serverTime: _dt(j['serverTime']) ?? DateTime.now(),
      profile: StudentProfile.fromJson(_m(j['profile'])),
      subjects: _l(j['subjects']).map(SubjectProgress.fromJson).toList(),
      todayDate: _s(today['date']),
      holiday: _sn(today['holiday']),
      periods: _l(today['periods']).map(Period.fromJson).toList(),
      liveNow: _l(j['liveNow']).map(LiveItem.fromJson).toList(),
      nextTest: j['nextTest'] is Map<String, dynamic> ? TestInfo.fromJson(j['nextTest'] as Map<String, dynamic>) : null,
      openTestsCount: _i(j['openTestsCount']),
      unreadNotices: _i(notices['unread']),
      latestNotices: _l(notices['latest']).map(NoticeItem.fromJson).toList(),
      attendanceMonth: _dn(att['monthPercent']),
      attendanceYear: _dn(att['yearPercent']),
      averagePercent: _dn(res['averagePercent']),
      testsTaken: _i(res['testsTaken']),
      studyTotal: _i(study['total']),
      studyCompleted: _i(study['completed']),
    );
  }
}

// ---------------------------------------------------------------- study materials

class MaterialItem {
  const MaterialItem({
    required this.id,
    required this.subjectId,
    required this.subjectCode,
    required this.subjectName,
    required this.chapter,
    required this.title,
    required this.kind,
    required this.hasFile,
    required this.allowOffline,
    this.description,
    this.fileName,
    this.mimeType,
    this.sizeBytes,
    this.durationMin,
    this.externalUrl,
    this.publishedAt,
    this.completedAt,
  });
  final String id;
  final String subjectId;
  final String subjectCode;
  final String subjectName;
  final String chapter;
  final String title;
  final String kind; // PDF | SLIDES | VIDEO | LINK
  final bool hasFile;
  final bool allowOffline;
  final String? description;
  final String? fileName;
  final String? mimeType;
  final int? sizeBytes;
  final int? durationMin;
  final String? externalUrl;
  final DateTime? publishedAt;
  final DateTime? completedAt;

  bool get isVideo => kind == 'VIDEO';
  String get extension => mimeType == 'video/webm' ? 'webm' : (isVideo ? 'mp4' : 'pdf');

  factory MaterialItem.fromJson(Map<String, dynamic> j) => MaterialItem(
        id: _s(j['id']),
        subjectId: _s(j['subjectId']),
        subjectCode: _s(j['subjectCode']),
        subjectName: _s(j['subjectName']),
        chapter: _s(j['chapter']),
        title: _s(j['title']),
        kind: _s(j['kind'], 'PDF'),
        hasFile: _b(j['hasFile']),
        allowOffline: _b(j['allowOffline']),
        description: _sn(j['description']),
        fileName: _sn(j['fileName']),
        mimeType: _sn(j['mimeType']),
        sizeBytes: _in(j['sizeBytes']),
        durationMin: _in(j['durationMin']),
        externalUrl: _sn(j['externalUrl']),
        publishedAt: _dt(j['publishedAt']),
        completedAt: _dt(j['completedAt']),
      );
}

// ---------------------------------------------------------------- tests

class PaperQuestion {
  const PaperQuestion({required this.id, required this.position, required this.text, required this.options, required this.marks});
  final String id;
  final int position;
  final String text;
  final List<String> options;
  final double marks;

  factory PaperQuestion.fromJson(Map<String, dynamic> j) => PaperQuestion(
        id: _s(j['id']),
        position: _i(j['position']),
        text: _s(j['text']),
        options: _ls(j['options']),
        marks: _d(j['marks'], 1),
      );
}

class Paper {
  const Paper({
    required this.testId,
    required this.title,
    required this.subjectCode,
    required this.subjectName,
    required this.durationMin,
    required this.closesAt,
    required this.negativeMarks,
    required this.questions,
    this.instructions,
  });
  final String testId;
  final String title;
  final String subjectCode;
  final String subjectName;
  final int durationMin;
  final DateTime closesAt;
  final double negativeMarks;
  final List<PaperQuestion> questions;
  final String? instructions;

  factory Paper.fromJson(Map<String, dynamic> j) => Paper(
        testId: _s(j['testId']),
        title: _s(j['title']),
        subjectCode: _s(j['subjectCode']),
        subjectName: _s(j['subjectName']),
        durationMin: _i(j['durationMin'], 30),
        closesAt: _dt(j['closesAt']) ?? DateTime.now(),
        negativeMarks: _d(j['negativeMarks']),
        questions: _l(j['questions']).map(PaperQuestion.fromJson).toList(),
        instructions: _sn(j['instructions']),
      );
}

class SubmitOutcome {
  const SubmitOutcome({required this.reviewStatus, this.score, this.maxScore, this.percent, this.correctCount, this.message});
  final String reviewStatus;
  final double? score;
  final double? maxScore;
  final double? percent;
  final int? correctCount;
  final String? message;

  factory SubmitOutcome.fromJson(Map<String, dynamic> j) {
    final r = j['result'] is Map<String, dynamic> ? j['result'] as Map<String, dynamic> : null;
    return SubmitOutcome(
      reviewStatus: _s(j['reviewStatus'], 'NONE'),
      score: r == null ? null : _dn(r['score']),
      maxScore: r == null ? null : _dn(r['maxScore']),
      percent: r == null ? null : _dn(r['percent']),
      correctCount: r == null ? null : _in(r['correctCount']),
      message: _sn(j['reviewReason']),
    );
  }
}

class ReviewQuestion {
  const ReviewQuestion({required this.position, required this.text, required this.options, required this.correctIndex, this.yourAnswer, this.explanation, this.topic});
  final int position;
  final String text;
  final List<String> options;
  final int correctIndex;
  final int? yourAnswer;
  final String? explanation;
  final String? topic;

  factory ReviewQuestion.fromJson(Map<String, dynamic> j) => ReviewQuestion(
        position: _i(j['position']),
        text: _s(j['text']),
        options: _ls(j['options']),
        correctIndex: _i(j['correctIndex']),
        yourAnswer: _in(j['yourAnswer']),
        explanation: _sn(j['explanation']),
        topic: _sn(j['topic']),
      );
}

class TestReview {
  const TestReview({required this.title, required this.questions, this.score, this.maxScore, this.percent});
  final String title;
  final List<ReviewQuestion> questions;
  final double? score;
  final double? maxScore;
  final double? percent;

  factory TestReview.fromJson(Map<String, dynamic> j) => TestReview(
        title: _s(_m(j['test'])['title']),
        questions: _l(j['questions']).map(ReviewQuestion.fromJson).toList(),
        score: _dn(j['score']),
        maxScore: _dn(j['maxScore']),
        percent: _dn(j['percent']),
      );
}

// ---------------------------------------------------------------- results

class HistoryPoint {
  const HistoryPoint({required this.testId, required this.title, required this.subjectCode, this.submittedAt, this.score, this.maxScore, this.percent});
  final String testId;
  final String title;
  final String subjectCode;
  final DateTime? submittedAt;
  final double? score;
  final double? maxScore;
  final double? percent;

  factory HistoryPoint.fromJson(Map<String, dynamic> j) => HistoryPoint(
        testId: _s(j['testId']),
        title: _s(j['title']),
        subjectCode: _s(j['subjectCode']),
        submittedAt: _dt(j['submittedAt']),
        score: _dn(j['score']),
        maxScore: _dn(j['maxScore']),
        percent: _dn(j['percent']),
      );
}

class SubjectAverage {
  const SubjectAverage({required this.code, required this.name, required this.averagePercent, required this.tests});
  final String code;
  final String name;
  final double averagePercent;
  final int tests;

  factory SubjectAverage.fromJson(Map<String, dynamic> j) =>
      SubjectAverage(code: _s(j['subjectCode']), name: _s(j['subjectName']), averagePercent: _d(j['averagePercent']), tests: _i(j['tests']));
}

class TopicToRevise {
  const TopicToRevise({required this.subjectCode, required this.topic, required this.wrong, required this.asked});
  final String subjectCode;
  final String topic;
  final int wrong;
  final int asked;

  factory TopicToRevise.fromJson(Map<String, dynamic> j) =>
      TopicToRevise(subjectCode: _s(j['subjectCode']), topic: _s(j['topic']), wrong: _i(j['wrong']), asked: _i(j['asked']));
}

class ResultsSummary {
  const ResultsSummary({required this.testsTaken, required this.awaitingReview, required this.history, required this.subjects, required this.topics, this.averagePercent});
  final int testsTaken;
  final int awaitingReview;
  final List<HistoryPoint> history;
  final List<SubjectAverage> subjects;
  final List<TopicToRevise> topics;
  final double? averagePercent;

  factory ResultsSummary.fromJson(Map<String, dynamic> j) => ResultsSummary(
        testsTaken: _i(j['testsTaken']),
        awaitingReview: _i(j['awaitingReview']),
        history: _l(j['history']).map(HistoryPoint.fromJson).toList(),
        subjects: _l(j['subjects']).map(SubjectAverage.fromJson).toList(),
        topics: _l(j['topicsToRevise']).map(TopicToRevise.fromJson).toList(),
        averagePercent: _dn(j['averagePercent']),
      );
}

// ---------------------------------------------------------------- attendance

class AttendanceDay {
  const AttendanceDay({required this.date, required this.sessions, this.status, this.holiday});
  final String date;
  final String? status; // PRESENT | ABSENT | LEAVE | PARTIAL | HOLIDAY
  final String? holiday;
  final List<({String label, String status, String? note})> sessions;

  factory AttendanceDay.fromJson(Map<String, dynamic> j) => AttendanceDay(
        date: _s(j['date']),
        status: _sn(j['status']),
        holiday: _sn(j['holiday']),
        sessions: _l(j['sessions']).map((s) => (label: _s(s['label']), status: _s(s['status']), note: _sn(s['note']))).toList(),
      );
}

class AttendanceMonth {
  const AttendanceMonth({required this.month, required this.today, required this.days, required this.daysPresent, required this.daysRecorded, this.monthPercent, this.yearPercent});
  final String month;
  final String today;
  final List<AttendanceDay> days;
  final int daysPresent;
  final int daysRecorded;
  final double? monthPercent;
  final double? yearPercent;

  factory AttendanceMonth.fromJson(Map<String, dynamic> j) => AttendanceMonth(
        month: _s(j['month']),
        today: _s(j['today']),
        days: _l(j['days']).map(AttendanceDay.fromJson).toList(),
        daysPresent: _i(j['daysPresent']),
        daysRecorded: _i(j['daysRecorded']),
        monthPercent: _dn(j['monthPercent']),
        yearPercent: _dn(j['yearPercent']),
      );
}

// ---------------------------------------------------------------- live

class LiveQuestionItem {
  const LiveQuestionItem({required this.id, required this.authorType, required this.authorName, required this.body, required this.createdAt});
  final String id;
  final String authorType;
  final String authorName;
  final String body;
  final DateTime createdAt;

  factory LiveQuestionItem.fromJson(Map<String, dynamic> j) => LiveQuestionItem(
        id: _s(j['id']),
        authorType: _s(j['authorType']),
        authorName: _s(j['authorName']),
        body: _s(j['body']),
        createdAt: _dt(j['createdAt']) ?? DateTime.now(),
      );
}

// ---------------------------------------------------------------- auth

class LoginResult {
  const LoginResult({required this.accessToken, required this.refreshToken, required this.mustChangePassword, required this.hasPin});
  final String accessToken;
  final String refreshToken;
  final bool mustChangePassword;
  final bool hasPin;

  factory LoginResult.fromJson(Map<String, dynamic> j) => LoginResult(
        accessToken: _s(j['accessToken']),
        refreshToken: _s(j['refreshToken']),
        mustChangePassword: _b(j['mustChangePassword']),
        hasPin: _b(j['hasPin']),
      );
}
