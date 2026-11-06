import 'dart:convert';

import 'api_client.dart';
import 'models.dart';
import 'secure_store.dart';

/// An attempt in progress on this tablet. Saved after every answer, so a closed app,
/// a flat battery or lost Wi-Fi never loses work.
class LocalAttempt {
  LocalAttempt({
    required this.testId,
    required this.mode,
    required this.paperJson,
    required this.answers,
    required this.flagged,
    required this.elapsedSec,
    required this.limitSec,
    required this.clientStartedAt,
    this.packageToken,
    this.attemptId,
    this.currentIndex = 0,
    Set<String>? visited,
  }) : visited = visited ?? {};

  final String testId;

  /// The server's attempt id (null for a paper started offline). Staff actions are matched against it.
  String? attemptId;

  /// Question on screen (from 0), so the student comes back to the same place.
  int currentIndex;

  /// Questions opened at least once, to count the ones skipped.
  final Set<String> visited;
  String mode; // ONLINE | OFFLINE
  final Map<String, dynamic> paperJson;
  final Map<String, int?> answers;
  final Set<String> flagged;

  /// Seconds the student has spent, counted by the app (not the tablet clock, which can be changed).
  int elapsedSec;

  /// Seconds available: the time limit, or less if the server says the test closes sooner.
  /// Staff can add time while the test runs ("revive"), so this can grow.
  int limitSec;
  final DateTime clientStartedAt;
  final String? packageToken;

  Paper get paper => Paper.fromJson(paperJson);
  int get remainingSec => (limitSec - elapsedSec).clamp(0, limitSec);
  int get answeredCount => answers.values.where((v) => v != null).length;
  int get skippedCount => visited.where((id) => answers[id] == null).length;

  /// Sets the time left from the server's deadline and clock.
  void applyDeadline(DateTime? deadline, DateTime? serverNow) {
    if (deadline == null || serverNow == null) return;
    limitSec = elapsedSec + deadline.difference(serverNow).inSeconds.clamp(0, 24 * 3600);
  }

  Map<String, Object?> toJson() => {
        'testId': testId,
        'mode': mode,
        'paper': paperJson,
        'answers': answers,
        'flagged': flagged.toList(),
        'elapsedSec': elapsedSec,
        'limitSec': limitSec,
        'clientStartedAt': clientStartedAt.toUtc().toIso8601String(),
        'packageToken': packageToken,
        'attemptId': attemptId,
        'currentIndex': currentIndex,
        'visited': visited.toList(),
      };

  static LocalAttempt? fromJson(Object? raw) {
    if (raw is! Map<String, dynamic>) return null;
    try {
      final answers = <String, int?>{};
      (raw['answers'] as Map<String, dynamic>? ?? {}).forEach((k, v) => answers[k] = v is num ? v.toInt() : null);
      return LocalAttempt(
        testId: raw['testId'] as String,
        mode: raw['mode'] as String? ?? 'ONLINE',
        paperJson: raw['paper'] as Map<String, dynamic>,
        answers: answers,
        flagged: ((raw['flagged'] as List?) ?? const []).whereType<String>().toSet(),
        elapsedSec: (raw['elapsedSec'] as num?)?.toInt() ?? 0,
        limitSec: (raw['limitSec'] as num?)?.toInt() ?? 1800,
        clientStartedAt: DateTime.tryParse(raw['clientStartedAt'] as String? ?? '') ?? DateTime.now(),
        packageToken: raw['packageToken'] as String?,
        attemptId: raw['attemptId'] as String?,
        currentIndex: (raw['currentIndex'] as num?)?.toInt() ?? 0,
        visited: ((raw['visited'] as List?) ?? const []).whereType<String>().toSet(),
      );
    } catch (_) {
      return null;
    }
  }
}

class TestStore {
  TestStore({required this.api, required this.store});
  final ApiClient api;
  final SecureStore store;

  static String _pkg(String id) => 'pkg:$id';
  static String _attempt(String id) => 'attempt:$id';
  static String _outbox(String id) => 'outbox:$id';

  // ------------------------------------------------------------ offline papers

  /// Downloads a test paper so it can be taken without Wi-Fi (only for tests that allow it).
  Future<void> downloadPaper(String testId) async {
    final r = await api.getJson('/me/tests/$testId/package') as Map<String, dynamic>;
    await store.writeJson(_pkg(testId), {'paper': r['paper'], 'packageToken': r['packageToken']});
  }

  Future<Set<String>> downloadedPapers() async =>
      (await store.readPrefix('pkg:')).keys.map((k) => k.substring(4)).toSet();

  Future<void> removePaper(String testId) => store.delete(_pkg(testId));

  // ------------------------------------------------------------ attempts

  Future<LocalAttempt?> saved(String testId) async => LocalAttempt.fromJson(await store.readJson(_attempt(testId)));

  Future<void> save(LocalAttempt a) => store.writeJson(_attempt(a.testId), a.toJson());

  /// Resumes a saved attempt, or starts one: online when the server can be reached,
  /// otherwise from the downloaded paper. Online, the server's saved progress is used, so a
  /// student can carry on from the same question after a crash, on this or another tablet.
  Future<LocalAttempt> begin(TestInfo t, {String? deviceSerial}) async {
    final existing = await saved(t.id);
    final pkg = await store.readJson(_pkg(t.id));
    final token = pkg is Map<String, dynamic> ? pkg['packageToken'] as String? : null;
    if (existing != null && existing.mode == 'OFFLINE') return existing;
    try {
      final r = await api.postJson('/me/tests/${t.id}/start', {if (deviceSerial != null) 'deviceSerial': deviceSerial}) as Map<String, dynamic>;
      final deadline = DateTime.tryParse(r['deadline'] as String? ?? '');
      final serverNow = DateTime.tryParse(r['serverTime'] as String? ?? '');
      final attemptId = r['attemptId'] as String?;
      // Same attempt as on this tablet: keep the local copy (it is newest) and refresh the time left.
      if (existing != null && (existing.attemptId == null || existing.attemptId == attemptId)) {
        existing.attemptId = attemptId;
        existing.applyDeadline(deadline, serverNow);
        await save(existing);
        return existing;
      }
      final serverAnswers = <String, int?>{};
      (r['answers'] as Map<String, dynamic>? ?? {}).forEach((k, v) => serverAnswers[k] = v is num ? v.toInt() : null);
      final a = LocalAttempt(
        testId: t.id,
        mode: 'ONLINE',
        paperJson: r['paper'] as Map<String, dynamic>,
        answers: serverAnswers,
        flagged: {},
        elapsedSec: 0,
        // Remaining time comes from the server's clock, so changing the tablet clock does not help.
        limitSec: deadline != null && serverNow != null ? deadline.difference(serverNow).inSeconds.clamp(0, 24 * 3600) : t.durationMin * 60,
        clientStartedAt: DateTime.now(),
        packageToken: token,
        attemptId: attemptId,
        currentIndex: ((r['currentQuestion'] as num?)?.toInt() ?? 1) - 1,
        visited: serverAnswers.keys.toSet(),
      );
      await save(a);
      return a;
    } on OfflineException {
      if (existing != null) return existing;
      if (pkg is! Map<String, dynamic> || token == null) rethrow;
      final paper = pkg['paper'] as Map<String, dynamic>;
      final a = LocalAttempt(
        testId: t.id,
        mode: 'OFFLINE',
        paperJson: paper,
        answers: {},
        flagged: {},
        elapsedSec: 0,
        limitSec: t.durationMin * 60,
        clientStartedAt: DateTime.now(),
        packageToken: token,
      );
      await save(a);
      return a;
    } on ApiException catch (e) {
      if (e.statusCode == 409 && existing != null) {
        // Submitted already (for example by a teacher): this tablet's copy is no longer needed.
        if (e.message.contains('submitted')) {
          await store.delete(_attempt(t.id));
          rethrow;
        }
        // Closed while this tablet still holds answers: keep them so they are submitted (and reviewed).
        return existing;
      }
      rethrow;
    }
  }

  /// Reports where the student is, so staff can follow the test live. Also brings back staff
  /// actions: more time, "submitted by teacher" or "start again". Never throws.
  Future<ProgressReply?> progress(LocalAttempt a, {int? battery, bool? charging}) async {
    final id = a.attemptId;
    if (id == null || a.mode != 'ONLINE') return null;
    try {
      final r = await api.postJson('/me/tests/${a.testId}/progress', {
        'attemptId': id,
        'currentQuestion': a.currentIndex + 1,
        'answers': a.answers,
        'skipped': a.skippedCount,
        if (battery != null) 'battery': battery.clamp(0, 100),
        if (charging != null) 'charging': charging,
      }) as Map<String, dynamic>;
      final reply = ProgressReply.fromJson(r);
      if (reply.status == 'ok') {
        a.applyDeadline(reply.deadline, reply.serverTime);
      } else {
        await _finished(a.testId);
      }
      return reply;
    } catch (_) {
      return null;
    }
  }

  /// Submits, or queues the answers on the tablet when offline. Returns null when queued.
  Future<SubmitOutcome?> submit(LocalAttempt a, {String? deviceSerial}) async {
    final body = <String, Object?>{
      'mode': a.mode,
      'answers': a.answers,
      'clientStartedAt': a.clientStartedAt.toUtc().toIso8601String(),
      'clientSubmittedAt': DateTime.now().toUtc().toIso8601String(),
      'elapsedSec': a.elapsedSec,
      if (deviceSerial != null) 'deviceSerial': deviceSerial,
      if (a.packageToken != null) 'packageToken': a.packageToken,
    };
    try {
      final r = await _post(a.testId, body);
      await _finished(a.testId);
      return r;
    } on OfflineException {
      // Online attempts that lose Wi-Fi switch to the offline route when a paper token exists.
      if (a.mode == 'ONLINE' && a.packageToken != null) body['mode'] = 'OFFLINE';
      await store.writeJson(_outbox(a.testId), body);
      await store.delete(_attempt(a.testId));
      return null;
    }
  }

  Future<SubmitOutcome> _post(String testId, Map<String, Object?> body) async =>
      SubmitOutcome.fromJson(await api.postJson('/me/tests/$testId/submit', body) as Map<String, dynamic>);

  Future<void> _finished(String testId) async {
    await store.delete(_attempt(testId));
    await store.delete(_pkg(testId));
    await store.delete(_outbox(testId));
  }

  Future<int> pendingUploads() async => (await store.readPrefix('outbox:')).length;

  /// Uploads answers saved while offline. Stops at the first network failure.
  Future<int> flushOutbox() async {
    var sent = 0;
    for (final e in (await store.readPrefix('outbox:')).entries) {
      final testId = e.key.substring(7);
      final body = jsonDecode(e.value) as Map<String, dynamic>;
      try {
        await _post(testId, body);
        await _finished(testId);
        sent++;
      } on OfflineException {
        break;
      } on ApiException catch (err) {
        // 409 = the server already has it; 4xx = it can never be accepted. Either way, stop retrying.
        if (err.statusCode >= 400 && err.statusCode < 500) await _finished(testId);
      }
    }
    return sent;
  }

  Future<TestReview> review(String testId) async => TestReview.fromJson(await api.getJson('/me/tests/$testId/review') as Map<String, dynamic>);
}

/// The server's answer to a progress report.
class ProgressReply {
  const ProgressReply({required this.status, this.deadline, this.serverTime, this.byStaff = false, this.outcome});

  /// ok | submitted | reset
  final String status;
  final DateTime? deadline;
  final DateTime? serverTime;
  final bool byStaff;
  final SubmitOutcome? outcome;

  factory ProgressReply.fromJson(Map<String, dynamic> j) => ProgressReply(
        status: j['status'] as String? ?? 'ok',
        deadline: DateTime.tryParse(j['deadline'] as String? ?? ''),
        serverTime: DateTime.tryParse(j['serverTime'] as String? ?? ''),
        byStaff: j['byStaff'] == true,
        outcome: j['outcome'] is Map<String, dynamic> ? SubmitOutcome.fromJson(j['outcome'] as Map<String, dynamic>) : null,
      );
}
