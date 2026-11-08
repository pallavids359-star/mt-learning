import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/foundation.dart';

import '../data/api_client.dart';
import '../data/file_store.dart';
import '../data/models.dart';
import '../data/prep_api.dart';
import '../data/prep_models.dart';
import '../data/secure_store.dart';
import '../data/test_store.dart';
import 'config.dart';
import 'device_identity.dart';

enum AppStage { starting, deviceSetup, signedOut, mustChangePassword, signedIn }

enum SyncStatus { idle, syncing, synced, offline, failed }

/// Single source of truth for the session, cached data and sync status.
/// Every screen reads from here, so the whole app works from the encrypted cache when offline.
class AppState extends ChangeNotifier {
  AppState({required this.api, required this.store, required this.device, FileStore? files})
      : files = files ?? FileStore(),
        tests = TestStore(api: api, store: store),
        prepApi = PrepApi(api);

  final ApiClient api;
  final SecureStore store;
  final DeviceIdentity device;
  final FileStore files;
  final TestStore tests;
  final PrepApi prepApi;

  AppStage stage = AppStage.starting;
  SyncStatus syncStatus = SyncStatus.idle;
  DateTime? lastSyncedAt;
  String? tabletSerial;

  /// Whether the staff PIN for the kiosk lock has been set on this tablet.
  bool hasAdminPin = false;
  String? lastStudentCode;
  String? lastStudentName;
  bool lastHasPin = false;
  String? notice; // shown on the sign-in screen, e.g. why the student was signed out

  HomeData? home;
  List<MaterialItem> materials = const [];
  List<TestInfo> testList = const [];
  ResultsSummary? results;
  List<NoticeItem> notices = const [];
  List<LiveItem> live = const [];
  AttendanceMonth? attendance;
  Uint8List? photo;

  /// GenPrep exams (NEET, JEE, KCET) and the one this student prepares for.
  PrepExams? prep;

  /// Practice dashboard for the chosen exam, cached so Home opens offline.
  PrepDashboard? prepDashboard;
  Set<String> downloadedMaterials = {};
  Set<String> downloadedPapers = {};
  int pendingUploads = 0;
  final Map<String, double> downloadProgress = {};

  Timer? _heartbeat;
  bool _wiping = false;

  static const _cacheKeys = ['home', 'tests', 'results', 'prepExams'];

  // ------------------------------------------------------------ lifecycle

  Future<void> start() async {
    tabletSerial = await store.readTabletSerial();
    hasAdminPin = (await store.readAdminPin())?.isNotEmpty ?? false;
    final last = await store.readLastStudent();
    lastStudentCode = last.code;
    lastStudentName = last.name;
    lastHasPin = last.hasPin;
    if (tabletSerial == null || tabletSerial!.isEmpty || !hasAdminPin) {
      _go(AppStage.deviceSetup);
      return;
    }
    if (await store.readRefreshToken() == null) {
      _go(AppStage.signedOut);
      return;
    }
    await _loadCache();
    if (home != null) {
      // Show cached data at once so the app opens offline, then refresh in the background.
      _go(home!.profile.mustChangePassword ? AppStage.mustChangePassword : AppStage.signedIn);
      unawaited(sync());
    } else {
      final ok = await sync();
      if (!ok && stage == AppStage.starting) {
        notice = syncStatus == SyncStatus.offline ? 'Connect to the college Wi-Fi to sign in.' : null;
        _go(AppStage.signedOut);
      }
    }
    _startHeartbeat();
  }

  Future<void> completeDeviceSetup(String serial, {required String adminPin}) async {
    final clean = serial.trim().toUpperCase();
    await store.writeTabletSerial(clean);
    await store.writeAdminPin(adminPin);
    tabletSerial = clean;
    hasAdminPin = true;
    if (await store.readRefreshToken() == null) {
      _go(AppStage.signedOut);
    } else {
      // A tablet set up before the admin PIN existed: carry on where it was.
      await start();
    }
  }

  /// Checks the staff PIN that unlocks the kiosk lock.
  Future<bool> checkAdminPin(String pin) async {
    final saved = await store.readAdminPin();
    return saved != null && saved.isNotEmpty && saved == pin;
  }

  // ------------------------------------------------------------ auth

  Future<void> signIn({required String studentCode, required String secret, required bool usePin}) async {
    final code = studentCode.trim().toUpperCase();
    // Another student's data must never be shown: wipe if the tablet changes hands.
    if (lastStudentCode != null && lastStudentCode != code) {
      // Answers still waiting to upload belong to the previous student and need their sign-in.
      if (await tests.pendingUploads() > 0) {
        throw ApiException(409, '${lastStudentName ?? lastStudentCode} has test answers on this tablet that have not uploaded yet. '
            'They need to sign in once on Wi-Fi first, or ask the college office.');
      }
      await _wipeLocal();
    }
    final result = await api.login(studentCode: code, secret: secret, usePin: usePin, deviceSerial: tabletSerial);
    lastStudentCode = code;
    lastHasPin = result.hasPin;
    await store.writeLastStudent(code: code, hasPin: result.hasPin);
    notice = null;
    if (result.mustChangePassword) {
      _go(AppStage.mustChangePassword);
      return;
    }
    await sync();
    _go(AppStage.signedIn);
    _startHeartbeat();
  }

  Future<void> changePassword(String current, String next) async {
    await api.changePassword(current, next);
    await sync();
    _go(AppStage.signedIn);
    _startHeartbeat();
  }

  Future<void> setPin(String currentPassword, String pin) async {
    await api.setPin(currentPassword, pin);
    lastHasPin = true;
    await store.writeLastStudent(code: lastStudentCode ?? '', name: lastStudentName, hasPin: true);
    unawaited(sync());
  }

  /// Signs out. Answers waiting to upload stay on the tablet unless [wipe] is set.
  Future<void> signOut({String? reason, bool wipe = false}) async {
    _heartbeat?.cancel();
    // Last chance to upload answers while the session is still valid.
    if (!wipe) {
      try {
        await tests.flushOutbox();
      } catch (_) {}
    }
    await api.logout();
    if (wipe) {
      await _wipeLocal();
      lastStudentCode = null;
      lastStudentName = null;
      lastHasPin = false;
    } else {
      // Downloaded notes stay for this student's next sign-in; they are wiped if someone else signs in.
      await store.clearSession();
      _clearMemory();
    }
    notice = reason;
    _go(AppStage.signedOut);
  }

  // ------------------------------------------------------------ sync

  /// Uploads queued answers, then refreshes every screen's data and caches it.
  /// Returns true when the server was reached.
  Future<bool> sync() async {
    if (syncStatus == SyncStatus.syncing) return false;
    syncStatus = SyncStatus.syncing;
    notifyListeners();
    try {
      await tests.flushOutbox();
      final results = await Future.wait([
        api.getJson('/me/student/home'),
        api.getJson('/me/tests'),
        api.getJson('/me/results'),
        api.getJson('/me/prep/exams'),
      ]);
      for (var i = 0; i < _cacheKeys.length; i++) {
        await store.writeJson('cache:${_cacheKeys[i]}', results[i]);
      }
      await store.writeJson('cache:syncedAt', DateTime.now().toUtc().toIso8601String());
      _apply(Map.fromIterables(_cacheKeys, results));
      lastSyncedAt = DateTime.now();
      syncStatus = SyncStatus.synced;
      await refreshPrep(quiet: true);
      await _refreshLocalIndexes();
      if (home!.profile.hasPhoto && photo == null) {
        final bytes = await api.fetchPhoto();
        if (bytes != null) photo = Uint8List.fromList(bytes);
      }
      if (home!.profile.mustChangePassword) {
        _go(AppStage.mustChangePassword);
      } else if (stage == AppStage.starting) {
        _go(AppStage.signedIn);
      }
      notifyListeners();
      return true;
    } on OfflineException {
      syncStatus = SyncStatus.offline;
      await _refreshLocalIndexes();
      notifyListeners();
      return false;
    } on SessionExpiredException {
      await signOut(reason: 'Your session has ended. Please sign in again.');
      return false;
    } catch (e) {
      debugPrint('sync failed: $e');
      syncStatus = SyncStatus.failed;
      notifyListeners();
      return false;
    }
  }

  void _apply(Map<String, Object?> data) {
    List<Map<String, dynamic>> list(Object? v) => v is List ? v.whereType<Map<String, dynamic>>().toList() : const [];
    if (data['home'] is Map<String, dynamic>) home = HomeData.fromJson(data['home'] as Map<String, dynamic>);
    testList = list(data['tests']).map(TestInfo.fromJson).toList();
    if (data['results'] is Map<String, dynamic>) results = ResultsSummary.fromJson(data['results'] as Map<String, dynamic>);
    if (data['prepExams'] is Map<String, dynamic>) prep = PrepExams.fromJson(data['prepExams'] as Map<String, dynamic>);
    if (data['prepDash'] is Map<String, dynamic>) prepDashboard = PrepDashboard.fromJson(data['prepDash'] as Map<String, dynamic>);
  }

  // ------------------------------------------------------------ practice (GenPrep)

  /// The exam the student prepares for; null until they choose one.
  PrepExam? get exam => prep?.target;

  Future<void> chooseExam(String examId) async {
    prep = await prepApi.setTarget(examId);
    await store.writeJson('cache:prepExams', {
      'source': prep!.source,
      'targetExamId': prep!.targetExamId,
      'exams': [for (final e in prep!.exams) {'id': e.id, 'code': e.code, 'name': e.name, 'durationMinutes': e.durationMinutes, 'marking': {'correct': e.marking.correct, 'incorrect': e.marking.incorrect}}],
    });
    prepDashboard = null;
    notifyListeners();
    await refreshPrep();
  }

  /// Reloads the practice dashboard. [quiet] swallows network errors (used during sync).
  Future<void> refreshPrep({bool quiet = false}) async {
    final id = exam?.id;
    if (id == null) return;
    try {
      final raw = await api.getJson('/me/prep/dashboard?examId=${Uri.encodeQueryComponent(id)}');
      if (raw is Map<String, dynamic>) {
        prepDashboard = PrepDashboard.fromJson(raw);
        await store.writeJson('cache:prepDash', raw);
        notifyListeners();
      }
    } catch (e) {
      if (!quiet) rethrow;
    }
  }

  Future<void> _loadCache() async {
    final data = <String, Object?>{};
    for (final k in [..._cacheKeys, 'prepDash']) {
      data[k] = await store.readJson('cache:$k');
    }
    _apply(data);
    final at = await store.readJson('cache:syncedAt');
    if (at is String) lastSyncedAt = DateTime.tryParse(at)?.toLocal();
    await _refreshLocalIndexes();
  }

  Future<void> _refreshLocalIndexes() async {
    downloadedMaterials = await files.downloadedIds();
    downloadedPapers = await tests.downloadedPapers();
    pendingUploads = await tests.pendingUploads();
  }

  // ------------------------------------------------------------ study materials

  Future<void> downloadMaterial(MaterialItem m) async {
    if (downloadProgress.containsKey(m.id)) return;
    downloadProgress[m.id] = 0;
    notifyListeners();
    try {
      final dest = await files.fileFor(m.id, m.extension);
      await api.download('/me/materials/${m.id}/file', dest, onProgress: (p) {
        downloadProgress[m.id] = p;
        notifyListeners();
      });
      downloadedMaterials = {...downloadedMaterials, m.id};
      unawaited(_progress(m.id, 'downloaded'));
    } finally {
      downloadProgress.remove(m.id);
      notifyListeners();
    }
  }

  Future<void> removeDownload(MaterialItem m) async {
    await files.remove(m.id, m.extension);
    downloadedMaterials = {...downloadedMaterials}..remove(m.id);
    notifyListeners();
  }

  void materialOpened(MaterialItem m) => unawaited(_progress(m.id, 'opened'));

  Future<void> materialCompleted(MaterialItem m) async {
    await _progress(m.id, 'completed');
    materials = [
      for (final x in materials)
        x.id == m.id
            ? MaterialItem(
                id: x.id,
                subjectId: x.subjectId,
                subjectCode: x.subjectCode,
                subjectName: x.subjectName,
                chapter: x.chapter,
                title: x.title,
                kind: x.kind,
                hasFile: x.hasFile,
                allowOffline: x.allowOffline,
                description: x.description,
                fileName: x.fileName,
                mimeType: x.mimeType,
                sizeBytes: x.sizeBytes,
                durationMin: x.durationMin,
                externalUrl: x.externalUrl,
                publishedAt: x.publishedAt,
                completedAt: DateTime.now(),
              )
            : x,
    ];
    notifyListeners();
  }

  /// Progress events are best-effort; they are sent again by the next action when offline.
  Future<void> _progress(String id, String event) async {
    try {
      await api.postJson('/me/materials/$id/progress', {'event': event});
    } catch (_) {}
  }

  // ------------------------------------------------------------ tests

  Future<void> downloadPaper(TestInfo t) async {
    await tests.downloadPaper(t.id);
    downloadedPapers = {...downloadedPapers, t.id};
    notifyListeners();
  }

  /// Called when a test finishes (submitted or queued) to refresh lists and counters.
  Future<void> afterSubmit() async {
    await _refreshLocalIndexes();
    notifyListeners();
    unawaited(sync());
  }

  // ------------------------------------------------------------ notices

  Future<void> markNoticeRead(NoticeItem n) async {
    if (!n.unread) return;
    notices = [for (final x in notices) x.id == n.id ? x.markRead() : x];
    notifyListeners();
    try {
      await api.postJson('/me/notices/${n.id}/read');
    } catch (_) {}
  }

  int get unreadNotices => notices.where((n) => n.unread).length;

  // ------------------------------------------------------------ attendance

  Future<AttendanceMonth?> attendanceFor(String month) async {
    if (attendance?.month == month) return attendance;
    final r = await api.getJson('/me/attendance?month=$month');
    return r is Map<String, dynamic> ? AttendanceMonth.fromJson(r) : null;
  }

  // ------------------------------------------------------------ device

  void _startHeartbeat() {
    _heartbeat?.cancel();
    if (tabletSerial == null) return;
    Future<void> beat() async {
      if (stage != AppStage.signedIn || _wiping) return;
      try {
        final info = await device.describe();
        final action = await api.heartbeat(serial: tabletSerial!, appVersion: info.appVersion, androidVersion: info.androidVersion);
        if (action == 'SIGN_OUT_AND_WIPE') {
          _wiping = true;
          await signOut(reason: 'This tablet was reported lost or reassigned by the college. Contact the device administrator.', wipe: true);
          _wiping = false;
        }
      } catch (_) {
        // Heartbeats are best-effort; they resume when the tablet is back online.
      }
    }

    unawaited(beat());
    _heartbeat = Timer.periodic(AppConfig.heartbeatInterval, (_) => beat());
  }

  Future<void> _wipeLocal() async {
    await store.clearSession(wipe: true);
    await files.wipe();
    _clearMemory();
  }

  void _clearMemory() {
    home = null;
    materials = const [];
    testList = const [];
    results = null;
    notices = const [];
    live = const [];
    attendance = null;
    prep = null;
    prepDashboard = null;
    photo = null;
    lastSyncedAt = null;
    downloadedMaterials = {};
    downloadedPapers = {};
    pendingUploads = 0;
    syncStatus = SyncStatus.idle;
  }

  void _go(AppStage next) {
    stage = next;
    notifyListeners();
  }

  @override
  void dispose() {
    _heartbeat?.cancel();
    super.dispose();
  }
}
