import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:mt_student/core/format.dart';
import 'package:mt_student/data/models.dart';
import 'package:mt_student/data/test_store.dart';

void main() {
  group('HomeData.fromJson', () {
    test('parses a full server payload', () {
      final home = HomeData.fromJson({
        'serverTime': '2026-10-30T10:00:00.000Z',
        'profile': {
          'id': 'p1',
          'studentCode': 'MT26S0001',
          'fullName': 'Ananya Rao',
          'rollNumber': '21',
          'hasPhoto': true,
          'mustChangePassword': false,
          'hasPin': true,
          'section': {'id': 's1', 'name': 'A'},
          'classGroup': {'id': 'c1', 'name': '2nd PUC Science (PCMB)', 'pucYear': 'PUC_2', 'stream': 'PCMB'},
          'academicYear': {'id': 'y1', 'name': '2026-27'},
          'hostel': {'id': 'h1', 'name': 'Girls Hostel', 'roomNumber': '204'},
        },
        'subjects': [
          {'id': 'sub1', 'code': 'PHY', 'name': 'Physics', 'teacherNames': ['R. Kulkarni'], 'materialsTotal': 4, 'materialsCompleted': 1, 'progressPercent': 25},
        ],
        'today': {
          'date': '2026-10-30',
          'holiday': null,
          'periods': [
            {'startTime': '08:30', 'endTime': '09:20', 'subjectCode': 'PHY', 'subjectName': 'Physics', 'status': 'now', 'live': {'id': 'l1', 'joinOpen': true}},
          ],
        },
        'liveNow': [],
        'nextTest': {
          'id': 't1',
          'title': 'Electrostatics quiz',
          'subjectCode': 'PHY',
          'subjectName': 'Physics',
          'questionCount': 10,
          'durationMin': 20,
          'opensAt': '2026-10-30T08:00:00.000Z',
          'closesAt': '2026-10-31T15:30:00.000Z',
          'allowOffline': true,
          'negativeMarks': 0.25,
          'state': 'open',
          'attempt': null,
        },
        'openTestsCount': 2,
        'notices': {'unread': 3, 'latest': []},
        'attendance': {'monthPercent': 91.5, 'yearPercent': 88},
        'results': {'averagePercent': 72.4, 'testsTaken': 5},
        'study': {'total': 12, 'completed': 7, 'downloadable': 9},
      });

      expect(home.profile.firstName, 'Ananya');
      expect(home.profile.pucLabel, '2nd PUC');
      expect(home.profile.hostelName, 'Girls Hostel');
      expect(home.subjects.single.teacherNames, ['R. Kulkarni']);
      expect(home.periods.single.status, 'now');
      expect(home.periods.single.liveJoinOpen, isTrue);
      expect(home.nextTest!.canStart, isTrue);
      expect(home.nextTest!.negativeMarks, 0.25);
      expect(home.unreadNotices, 3);
      expect(home.attendanceYear, 88);
      expect(home.studyCompleted, 7);
    });

    test('survives an empty or old payload', () {
      final home = HomeData.fromJson({'profile': {}});
      expect(home.profile.fullName, 'Student');
      expect(home.subjects, isEmpty);
      expect(home.nextTest, isNull);
      expect(home.attendanceMonth, isNull);
    });
  });

  group('TestInfo', () {
    test('a submitted test cannot be started again', () {
      final t = TestInfo.fromJson({
        'id': 't1',
        'state': 'open',
        'attempt': {'status': 'SUBMITTED', 'reviewStatus': 'NONE', 'percent': 80},
      });
      expect(t.canStart, isFalse);
      expect(t.attempt!.percent, 80);
    });

    test('a test revived by staff can be continued after it closed', () {
      final t = TestInfo.fromJson({'id': 't1', 'state': 'closed', 'canStart': true, 'attempt': {'status': 'IN_PROGRESS'}});
      expect(t.canStart, isTrue);
    });
  });

  group('LocalAttempt', () {
    test('round-trips through JSON and tracks time left', () {
      final a = LocalAttempt(
        testId: 't1',
        mode: 'OFFLINE',
        paperJson: {
          'testId': 't1',
          'title': 'Quiz',
          'questions': [
            {'id': 'q1', 'position': 1, 'text': '2+2?', 'options': ['3', '4'], 'marks': 1},
          ],
        },
        answers: {'q1': 1},
        flagged: {'q1'},
        elapsedSec: 100,
        limitSec: 600,
        clientStartedAt: DateTime.utc(2026, 10, 30, 10),
        packageToken: 'tok',
      );
      final b = LocalAttempt.fromJson(jsonDecode(jsonEncode(a.toJson())))!;
      expect(b.mode, 'OFFLINE');
      expect(b.answers['q1'], 1);
      expect(b.flagged, contains('q1'));
      expect(b.remainingSec, 500);
      expect(b.answeredCount, 1);
      expect(b.paper.questions.single.options, ['3', '4']);
      expect(b.packageToken, 'tok');
    });

    test('time left never goes below zero', () {
      final a = LocalAttempt(
        testId: 't',
        mode: 'ONLINE',
        paperJson: const {},
        answers: {},
        flagged: {},
        elapsedSec: 900,
        limitSec: 600,
        clientStartedAt: DateTime.now(),
      );
      expect(a.remainingSec, 0);
    });

    test('keeps the live-monitor fields and counts skipped questions', () {
      final a = LocalAttempt(
        testId: 't',
        mode: 'ONLINE',
        paperJson: const {},
        answers: {'q1': 0, 'q2': null},
        flagged: {},
        elapsedSec: 100,
        limitSec: 600,
        clientStartedAt: DateTime.utc(2026, 11, 6),
        attemptId: 'a1',
        currentIndex: 2,
        visited: {'q1', 'q2', 'q3'},
      );
      final b = LocalAttempt.fromJson(jsonDecode(jsonEncode(a.toJson())))!;
      expect(b.attemptId, 'a1');
      expect(b.currentIndex, 2);
      expect(b.skippedCount, 2); // q2 cleared, q3 never answered
    });

    test('more time from staff raises the time left', () {
      final a = LocalAttempt(testId: 't', mode: 'ONLINE', paperJson: const {}, answers: {}, flagged: {}, elapsedSec: 500, limitSec: 600, clientStartedAt: DateTime.now());
      final now = DateTime.utc(2026, 11, 6, 10);
      a.applyDeadline(now.add(const Duration(minutes: 10)), now);
      expect(a.remainingSec, 600);
    });
  });

  group('ProgressReply', () {
    test('reads staff actions', () {
      final r = ProgressReply.fromJson({
        'status': 'submitted',
        'byStaff': true,
        'serverTime': '2026-11-06T10:00:00.000Z',
        'outcome': {'reviewStatus': 'NONE', 'result': {'score': 3, 'maxScore': 4, 'percent': 75, 'correctCount': 3}},
      });
      expect(r.byStaff, isTrue);
      expect(r.outcome!.percent, 75);
      expect(ProgressReply.fromJson({'status': 'reset'}).status, 'reset');
    });
  });

  group('AttendanceMonth', () {
    test('parses days and sessions', () {
      final m = AttendanceMonth.fromJson({
        'month': '2026-10',
        'today': '2026-10-30',
        'days': [
          {
            'date': '2026-10-29',
            'status': 'PARTIAL',
            'sessions': [
              {'label': 'Morning', 'status': 'PRESENT'},
              {'label': 'Night', 'status': 'ABSENT', 'note': 'Went home'},
            ],
          },
        ],
        'monthPercent': 90,
        'daysPresent': 18,
        'daysRecorded': 20,
      });
      expect(m.days.single.sessions.last.note, 'Went home');
      expect(m.daysPresent, 18);
    });
  });

  group('format', () {
    test('initials', () {
      expect(initials('Ananya Rao'), 'AR');
      expect(initials('Ravi'), 'R');
      expect(initials('  '), '?');
    });

    test('countdown', () {
      expect(formatCountdown(65), '1:05');
      expect(formatCountdown(3725), '1:02:05');
      expect(formatCountdown(-5), '0:00');
    });

    test('clock and percent', () {
      expect(formatClock('08:30'), '8:30 am');
      expect(formatClock('13:05'), '1:05 pm');
      expect(formatPercent(72.0), '72%');
      expect(formatPercent(72.46), '72.5%');
      expect(formatPercent(null), '—');
    });

    test('month names', () => expect(formatMonth('2026-10'), 'October 2026'));
  });
}
