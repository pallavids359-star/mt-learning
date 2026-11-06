import 'package:flutter/material.dart';

import '../../core/app_scope.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import '../../data/api_client.dart';
import '../../data/prep_models.dart';
import '../results/results_page.dart';
import 'exam_choice.dart';
import 'prep_home_page.dart';

/// Analytics: practice and mock performance, plus marks from the college's live tests.
class AnalyticsPage extends StatelessWidget {
  const AnalyticsPage({super.key});

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 2,
      child: Column(children: [
        Container(
          color: Palette.surface,
          child: const TabBar(
            tabs: [Tab(text: 'Practice & mock tests'), Tab(text: 'Live test marks')],
          ),
        ),
        const Expanded(child: TabBarView(children: [_PrepAnalytics(), ResultsPage()])),
      ]),
    );
  }
}

class _PrepAnalytics extends StatefulWidget {
  const _PrepAnalytics();

  @override
  State<_PrepAnalytics> createState() => _PrepAnalyticsState();
}

class _PrepAnalyticsState extends State<_PrepAnalytics> with AutomaticKeepAliveClientMixin {
  Future<(PrepAnalytics, List<HistoryItem>)>? _data;
  String? _examId;

  @override
  bool get wantKeepAlive => true;

  void _load(String examId) {
    _examId = examId;
    final api = AppScope.read(context).prepApi;
    _data = Future.wait([api.analytics(examId), api.history(examId)]).then((r) => (r[0] as PrepAnalytics, r[1] as List<HistoryItem>));
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final exam = AppScope.of(context).exam;
    if (exam == null) return const PageBody(children: [ExamChoice()]);
    if (_examId != exam.id) _load(exam.id);

    return FutureBuilder<(PrepAnalytics, List<HistoryItem>)>(
      future: _data,
      builder: (context, snap) {
        if (snap.hasError) {
          return PageBody(children: [
            EmptyState(
              icon: Icons.cloud_off,
              title: 'Analytics could not load',
              message: snap.error is OfflineException ? 'Connect to Wi-Fi and try again.' : friendlyError(snap.error!),
              action: FilledButton(onPressed: () => setState(() => _load(exam.id)), child: const Text('Try again')),
            ),
          ]);
        }
        if (snap.data == null) return const Center(child: CircularProgressIndicator());
        final (a, history) = snap.data!;
        final t = a.totals;
        final wide = MediaQuery.sizeOf(context).width >= 1000;

        final tiles = [
          MetricCard(label: 'Accuracy', value: '${t.accuracy}%', progress: t.accuracy / 100, tile: 0),
          MetricCard(label: 'Questions answered', value: '${t.attempted}', tile: 1),
          MetricCard(label: 'Mock tests', value: '${t.mocksTaken}', tile: 2),
          MetricCard(label: 'Time spent', value: _hours(t.timeSec), tile: 3),
        ];

        final left = <Widget>[
          _Daily(days: a.daily),
          const SizedBox(height: 14),
          _Subjects(subjects: a.subjects),
          if (a.mocks.isNotEmpty) ...[const SizedBox(height: 14), _MockTrend(mocks: a.mocks)],
        ];
        final right = <Widget>[
          _Chapters(chapters: a.chapters),
        ];

        return PageBody(children: [
          Text('${exam.code} analytics', style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: 14),
          LayoutBuilder(builder: (context, c) {
            final cols = c.maxWidth >= 760 ? 4 : 2;
            final w = (c.maxWidth - (cols - 1) * 12) / cols;
            return Wrap(spacing: 12, runSpacing: 12, children: [for (final x in tiles) SizedBox(width: w, child: x)]);
          }),
          const SizedBox(height: 16),
          if (t.attempted == 0)
            const EmptyState(icon: Icons.insights_outlined, title: 'No practice yet', message: 'Answer some questions in Practice or take a mock test to see your analytics.')
          else if (wide)
            Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Expanded(flex: 3, child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: left)),
              const SizedBox(width: 16),
              Expanded(flex: 2, child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: right)),
            ])
          else ...[...left, const SizedBox(height: 14), ...right],
          if (history.isNotEmpty) ...[
            const SizedBox(height: 22),
            const SectionTitle('History'),
            const SizedBox(height: 8),
            Card(child: Column(children: [for (final h in history) HistoryTile(item: h)])),
          ],
        ]);
      },
    );
  }
}

String _hours(int sec) {
  if (sec < 3600) return '${sec ~/ 60} min';
  final h = sec ~/ 3600;
  final m = (sec % 3600) ~/ 60;
  return m == 0 ? '$h h' : '$h h $m m';
}

Color _accColor(int acc) => acc >= 80 ? Palette.ok : (acc >= 50 ? Palette.warn : Palette.bad);

class _Daily extends StatelessWidget {
  const _Daily({required this.days});
  final List<DayCount> days;

  @override
  Widget build(BuildContext context) {
    final max = days.fold<int>(1, (m, d) => d.attempted > m ? d.attempted : m);
    final total = days.fold<int>(0, (s, d) => s + d.attempted);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('Last 30 days', style: Theme.of(context).textTheme.titleMedium),
          Text('$total questions answered', style: const TextStyle(color: Palette.ink2, fontSize: 13)),
          const SizedBox(height: 14),
          SizedBox(
            height: 110,
            child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
              for (final d in days)
                Expanded(
                  child: Tooltip(
                    message: '${formatDate(d.date)}: ${d.attempted} answered, ${d.correct} correct',
                    child: Container(
                      height: d.attempted == 0 ? 3 : 100 * d.attempted / max,
                      margin: const EdgeInsets.symmetric(horizontal: 1.5),
                      decoration: BoxDecoration(
                        color: d.attempted == 0 ? Palette.sunk : Palette.teal,
                        borderRadius: BorderRadius.circular(3),
                      ),
                    ),
                  ),
                ),
            ]),
          ),
        ]),
      ),
    );
  }
}

class _Subjects extends StatelessWidget {
  const _Subjects({required this.subjects});
  final List<ChapterStat> subjects;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('By subject', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 10),
          if (subjects.isEmpty) const Text('No answers yet.', style: TextStyle(color: Palette.ink2)),
          for (final s in subjects)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 7),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Row(children: [
                  Expanded(child: Text(s.name, style: const TextStyle(fontWeight: FontWeight.w700))),
                  Text('${s.accuracy}%', style: TextStyle(fontWeight: FontWeight.w700, color: _accColor(s.accuracy))),
                  Text('  · ${s.correct}/${s.attempted}', style: const TextStyle(color: Palette.ink2, fontSize: 12.5)),
                ]),
                const SizedBox(height: 6),
                ProgressBar(s.accuracy / 100, color: _accColor(s.accuracy)),
              ]),
            ),
        ]),
      ),
    );
  }
}

class _Chapters extends StatelessWidget {
  const _Chapters({required this.chapters});
  final List<ChapterStat> chapters;

  @override
  Widget build(BuildContext context) {
    final sorted = [...chapters]..sort((a, b) => a.accuracy.compareTo(b.accuracy));
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('Chapters, weakest first', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 6),
          if (sorted.isEmpty) const Text('No chapters practised yet.', style: TextStyle(color: Palette.ink2)),
          for (final c in sorted.take(15))
            ListTile(
              dense: true,
              contentPadding: EdgeInsets.zero,
              title: Text(c.name, style: const TextStyle(fontWeight: FontWeight.w700)),
              subtitle: Text('${c.subject} · ${c.attempted} answered'),
              trailing: Pill('${c.accuracy}%', tone: c.accuracy >= 80 ? PillTone.ok : (c.accuracy >= 50 ? PillTone.warn : PillTone.bad)),
            ),
        ]),
      ),
    );
  }
}

class _MockTrend extends StatelessWidget {
  const _MockTrend({required this.mocks});
  final List<MockScore> mocks;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('Mock test scores', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 12),
          SizedBox(
            height: 130,
            child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
              for (final m in mocks)
                Expanded(
                  child: Tooltip(
                    message: '${m.title}: ${m.score % 1 == 0 ? m.score.toInt() : m.score}/${m.maxScore.toInt()}',
                    child: Column(mainAxisAlignment: MainAxisAlignment.end, children: [
                      Text('${m.percentage}%', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: Palette.ink2)),
                      const SizedBox(height: 3),
                      Container(
                        height: 4 + 90 * m.percentage.clamp(0, 100) / 100,
                        margin: const EdgeInsets.symmetric(horizontal: 6),
                        decoration: BoxDecoration(
                          gradient: LinearGradient(begin: Alignment.bottomCenter, end: Alignment.topCenter, colors: Palette.tiles[2]),
                          borderRadius: BorderRadius.circular(6),
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(m.date == null ? '' : formatDay(m.date!).split(',').first, style: const TextStyle(fontSize: 10.5, color: Palette.ink3), maxLines: 1, overflow: TextOverflow.fade, softWrap: false),
                    ]),
                  ),
                ),
            ]),
          ),
        ]),
      ),
    );
  }
}
