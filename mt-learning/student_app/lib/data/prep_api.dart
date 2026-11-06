import 'api_client.dart';
import 'prep_models.dart';

/// Calls for GenPrep-style practice. Practice needs Wi-Fi: questions come from the bank.
class PrepApi {
  PrepApi(this.api);
  final ApiClient api;

  static String _q(String examId) => Uri.encodeQueryComponent(examId);
  Map<String, dynamic> _map(Object? v) => v is Map<String, dynamic> ? v : const {};
  List<Map<String, dynamic>> _list(Object? v) => v is List ? v.whereType<Map<String, dynamic>>().toList() : const [];

  Future<PrepExams> exams() async => PrepExams.fromJson(_map(await api.getJson('/me/prep/exams')));
  Future<PrepExams> setTarget(String examId) async => PrepExams.fromJson(_map(await api.putJson('/me/prep/target', {'examId': examId})));

  Future<List<SyllabusSubject>> syllabus(String examId) async =>
      _list(_map(await api.getJson('/me/prep/syllabus?examId=${_q(examId)}'))['subjects']).map(SyllabusSubject.fromJson).toList();

  Future<List<PrepTopic>> topics(String chapterId) async => _list(await api.getJson('/me/prep/chapters/${Uri.encodeComponent(chapterId)}/topics')).map(PrepTopic.fromJson).toList();

  Future<PrepAttempt> practice({required String examId, required List<String> chapterIds, List<String> topicIds = const [], String difficulty = 'any', int count = 10}) async =>
      PrepAttempt.fromJson(_map(await api.postJson('/me/prep/practice', {'examId': examId, 'chapterIds': chapterIds, 'topicIds': topicIds, 'difficulty': difficulty, 'count': count})));

  Future<AttemptOrReview> mock({required String examId, String? stream}) async =>
      attemptOrReview(_map(await api.postJson('/me/prep/mock', {'examId': examId, if (stream != null) 'stream': stream})));

  Future<List<MockRow>> mocks(String examId) async => _list(await api.getJson('/me/prep/mocks?examId=${_q(examId)}')).map(MockRow.fromJson).toList();

  Future<PrepAttempt> reviseWrong(String examId, {int count = 10}) async => PrepAttempt.fromJson(_map(await api.postJson('/me/prep/revise/wrong', {'examId': examId, 'count': count})));
  Future<PrepAttempt> reviseBookmarks(String examId, {int count = 10}) async =>
      PrepAttempt.fromJson(_map(await api.postJson('/me/prep/revise/bookmarks', {'examId': examId, 'count': count})));

  Future<AttemptOrReview> attempt(String id) async => attemptOrReview(_map(await api.getJson('/me/prep/attempts/$id')));

  Future<void> save(String id, Iterable<PrepAnswer> answers) => api.putJson('/me/prep/attempts/$id/answers', {'answers': answers.map((a) => a.toJson()).toList()});

  Future<PrepReview> submit(String id, Iterable<PrepAnswer> answers) async =>
      PrepReview.fromJson(_map(await api.postJson('/me/prep/attempts/$id/submit', {'answers': answers.map((a) => a.toJson()).toList()})));

  Future<List<BookmarkItem>> bookmarks(String examId) async => _list(await api.getJson('/me/prep/bookmarks?examId=${_q(examId)}')).map(BookmarkItem.fromJson).toList();
  Future<void> addBookmark(String questionId) => api.postJson('/me/prep/bookmarks', {'questionId': questionId});
  Future<void> removeBookmark(String questionId) => api.deleteJson('/me/prep/bookmarks/${Uri.encodeComponent(questionId)}');

  Future<PrepDashboard> dashboard(String examId) async => PrepDashboard.fromJson(_map(await api.getJson('/me/prep/dashboard?examId=${_q(examId)}')));
  Future<PrepAnalytics> analytics(String examId) async => PrepAnalytics.fromJson(_map(await api.getJson('/me/prep/analytics?examId=${_q(examId)}')));
  Future<List<HistoryItem>> history(String examId, {int page = 1}) async =>
      _list(_map(await api.getJson('/me/prep/history?examId=${_q(examId)}&page=$page'))['items']).map(HistoryItem.fromJson).toList();
}
