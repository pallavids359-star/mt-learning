import 'package:flutter/material.dart';

import '../../core/app_scope.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import '../../data/prep_models.dart';
import '../shell/app_shell.dart';
import '../tests/tests_page.dart';
import 'attempt_screen.dart';
import 'exam_choice.dart';
import 'result_screen.dart';

/// Home: what to do next, today's progress, weak chapters and recent work.
class PrepHomePage extends StatelessWidget {
  const PrepHomePage({super.key});

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final exam = app.exam;
    final name = app.home?.profile.firstName ?? app.lastStudentName?.split(' ').first ?? '';
    final t = Theme.of(context).textTheme;

    if (exam == null) {
      return PageBody(children: [
        Text('${greeting(DateTime.now())}${name.isEmpty ? '' : ', $name'}', style: t.headlineSmall),
        const SizedBox(height: 18),
        const ExamChoice(),
      ]);
    }

    final d = app.prepDashboard;
    final wide = MediaQuery.sizeOf(context).width >= 1000;
    final liveOpen = app.testList.where((x) => x.canStart).toList();

    final start = <Widget>[
      if (d?.inProgress != null) ...[_ContinueCard(item: d!.inProgress!), const SizedBox(height: 14)],
      if (liveOpen.isNotEmpty) ...[_LiveTestCard(count: liveOpen.length, first: liveOpen.first.title, onOpen: () => openTest(context, liveOpen.first)), const SizedBox(height: 14)],
      _QuickStart(wrong: d?.wrongCount ?? 0),
      const SizedBox(height: 16),
      LayoutBuilder(builder: (context, c) {
        final tiles = [
          MetricCard(label: 'Accuracy', value: d == null ? '—' : '${d.totals.accuracy}%', progress: (d?.totals.accuracy ?? 0) / 100, tile: 0),
          MetricCard(label: 'Questions done', value: '${d?.totals.attempted ?? 0}', tile: 1),
          MetricCard(label: 'Day streak', value: '${d?.streak ?? 0} 🔥', tile: 2),
        ];
        if (c.maxWidth < 560) return Column(children: [for (final x in tiles) Padding(padding: const EdgeInsets.only(bottom: 10), child: x)]);
        return Row(children: [for (var i = 0; i < tiles.length; i++) ...[if (i > 0) const SizedBox(width: 12), Expanded(child: tiles[i])]]);
      }),
    ];

    final side = <Widget>[
      if (d != null) _Week(days: d.last7Days),
      const SizedBox(height: 14),
      if (d != null) _Weak(weak: d.weak, strong: d.strong),
    ];

    return PageBody(children: [
      Row(children: [
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${greeting(DateTime.now())}${name.isEmpty ? '' : ', $name'}', style: t.headlineSmall),
            Text(formatDay(DateTime.now()), style: const TextStyle(color: Palette.ink2)),
          ]),
        ),
        ActionChip(avatar: const Icon(Icons.school_outlined, size: 18), label: Text('Preparing for ${exam.code}'), onPressed: () => changeExam(context)),
      ]),
      if (app.prep?.source == 'sample')
        const Padding(
          padding: EdgeInsets.only(top: 10),
          child: Pill('Sample questions: the full question bank is not connected yet', tone: PillTone.warn, icon: Icons.info_outline),
        ),
      const SizedBox(height: 18),
      if (wide)
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(flex: 3, child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: start)),
          const SizedBox(width: 18),
          Expanded(flex: 2, child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: side)),
        ])
      else ...[...start, const SizedBox(height: 16), ...side],
      if (d != null && d.recent.isNotEmpty) ...[
        const SizedBox(height: 22),
        SectionTitle('Recent', action: 'All analytics', onAction: () => AppShell.go(context, ShellTab.analytics)),
        const SizedBox(height: 8),
        Card(child: Column(children: [for (final h in d.recent) HistoryTile(item: h)])),
      ],
      if (d == null)
        const Padding(
          padding: EdgeInsets.only(top: 18),
          child: EmptyState(icon: Icons.cloud_download_outlined, title: 'Your progress will show here', message: 'Connect to Wi-Fi and pull down to refresh.'),
        ),
    ]);
  }
}

class _ContinueCard extends StatelessWidget {
  const _ContinueCard({required this.item});
  final ({String attemptId, String mode, String title, int? remainingSec}) item;

  @override
  Widget build(BuildContext context) {
    final app = AppScope.read(context);
    return Card(
      color: Palette.marigoldSoft,
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
        leading: const Icon(Icons.play_circle_fill, color: Palette.warn, size: 36),
        title: Text('Continue: ${item.title}', style: const TextStyle(fontWeight: FontWeight.w600)),
        subtitle: Text(item.remainingSec == null ? modeLabel(item.mode) : '${modeLabel(item.mode)} · ${formatCountdown(item.remainingSec!)} left'),
        trailing: FilledButton(onPressed: () => runAttempt(context, () => app.prepApi.attempt(item.attemptId)), child: const Text('Continue')),
      ),
    );
  }
}

class _LiveTestCard extends StatelessWidget {
  const _LiveTestCard({required this.count, required this.first, required this.onOpen});
  final int count;
  final String first;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Palette.board,
        borderRadius: BorderRadius.circular(18),
      ),
      child: Row(children: [
        const Icon(Icons.campaign_outlined, color: Colors.white, size: 32),
        const SizedBox(width: 14),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(count == 1 ? 'Live test open now' : '$count live tests open now', style: const TextStyle(color: Colors.white70, fontWeight: FontWeight.w500)),
            Text(first, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w600)),
          ]),
        ),
        FilledButton(
          style: FilledButton.styleFrom(backgroundColor: Colors.white, foregroundColor: Palette.board),
          onPressed: count == 1 ? onOpen : () => AppShell.go(context, ShellTab.live),
          child: Text(count == 1 ? 'Start' : 'View'),
        ),
      ]),
    );
  }
}

class _QuickStart extends StatelessWidget {
  const _QuickStart({required this.wrong});
  final int wrong;

  @override
  Widget build(BuildContext context) {
    final items = [
      (Icons.edit_note_rounded, 'Practice', 'Pick chapters', ShellTab.practice, 1),
      (Icons.timer_outlined, 'Mock test', 'Full exam, timed', ShellTab.mock, 2),
      (Icons.replay_rounded, 'Revise', wrong > 0 ? '$wrong wrong to fix' : 'Wrong & saved', ShellTab.revise, 3),
    ];
    return LayoutBuilder(builder: (context, c) {
      final cols = c.maxWidth >= 520 ? 3 : 1;
      final w = (c.maxWidth - (cols - 1) * 12) / cols;
      return Wrap(spacing: 12, runSpacing: 12, children: [
        for (final (icon, title, sub, tab, _) in items)
          SizedBox(
            width: w,
            child: Card(
              child: InkWell(
                borderRadius: BorderRadius.circular(16),
                onTap: () => AppShell.go(context, tab),
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Row(children: [
                    Container(
                      width: 46,
                      height: 46,
                      decoration: BoxDecoration(color: Palette.boardSoft, borderRadius: BorderRadius.circular(12)),
                      child: Icon(icon, color: Palette.board),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(title, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16)),
                        Text(sub, style: const TextStyle(color: Palette.ink2, fontSize: 13)),
                      ]),
                    ),
                    const Icon(Icons.chevron_right, color: Palette.ink3),
                  ]),
                ),
              ),
            ),
          ),
      ]);
    });
  }
}

class _Week extends StatelessWidget {
  const _Week({required this.days});
  final List<DayCount> days;

  @override
  Widget build(BuildContext context) {
    final max = days.fold<int>(1, (m, d) => d.attempted > m ? d.attempted : m);
    const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('This week', style: Theme.of(context).textTheme.titleMedium),
          const Text('Questions answered each day', style: TextStyle(color: Palette.ink2, fontSize: 13)),
          const SizedBox(height: 14),
          SizedBox(
            height: 120,
            child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
              for (final d in days)
                Expanded(
                  child: Semantics(
                    label: '${d.date}: ${d.attempted} questions',
                    child: Column(mainAxisAlignment: MainAxisAlignment.end, children: [
                      Text(d.attempted == 0 ? '' : '${d.attempted}', style: const TextStyle(fontSize: 11, color: Palette.ink2, fontWeight: FontWeight.w700)),
                      const SizedBox(height: 3),
                      Container(
                        height: d.attempted == 0 ? 4 : 80 * d.attempted / max,
                        margin: const EdgeInsets.symmetric(horizontal: 5),
                        decoration: BoxDecoration(
                          gradient: d.attempted == 0 ? null : LinearGradient(begin: Alignment.bottomCenter, end: Alignment.topCenter, colors: Palette.tiles[0]),
                          color: d.attempted == 0 ? Palette.sunk : null,
                          borderRadius: BorderRadius.circular(6),
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(names[(DateTime.tryParse(d.date)?.weekday ?? 1) - 1], style: const TextStyle(fontSize: 11, color: Palette.ink3)),
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

class _Weak extends StatelessWidget {
  const _Weak({required this.weak, required this.strong});
  final List<ChapterStat> weak;
  final List<ChapterStat> strong;

  @override
  Widget build(BuildContext context) {
    final app = AppScope.read(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('Chapters to work on', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          if (weak.isEmpty)
            const Text('Practise a few chapters (3+ questions each) to see where to focus.', style: TextStyle(color: Palette.ink2))
          else
            for (final c in weak)
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(c.name, style: const TextStyle(fontWeight: FontWeight.w700)),
                subtitle: Text('${c.accuracy}% accuracy · ${c.attempted} answered'),
                trailing: OutlinedButton(
                  onPressed: () => runAttempt(context, () => app.prepApi.practice(examId: app.exam!.id, chapterIds: [c.id], count: 10)),
                  child: const Text('Practise'),
                ),
              ),
          if (strong.isNotEmpty) ...[
            const Divider(height: 22),
            const Text('Strong chapters', style: TextStyle(fontWeight: FontWeight.w600)),
            const SizedBox(height: 6),
            Wrap(spacing: 6, runSpacing: 6, children: [for (final c in strong) Pill('${c.name} · ${c.accuracy}%', tone: PillTone.ok)]),
          ],
        ]),
      ),
    );
  }
}

/// One finished attempt; opens its result.
class HistoryTile extends StatelessWidget {
  const HistoryTile({super.key, required this.item});
  final HistoryItem item;

  @override
  Widget build(BuildContext context) {
    final app = AppScope.read(context);
    final pct = item.maxScore > 0 ? (item.score / item.maxScore * 100).round() : 0;
    return ListTile(
      onTap: () => runAttempt(context, () => app.prepApi.attempt(item.attemptId)),
      leading: CircleAvatar(
        backgroundColor: Palette.tiles[item.mode == 'mock' ? 2 : (item.mode == 'practice' ? 1 : 3)].first.withValues(alpha: 0.15),
        child: Icon(item.mode == 'mock' ? Icons.timer_outlined : (item.mode == 'practice' ? Icons.edit_note_rounded : Icons.replay_rounded),
            color: Palette.tiles[item.mode == 'mock' ? 2 : (item.mode == 'practice' ? 1 : 3)].last),
      ),
      title: Text(item.title, style: const TextStyle(fontWeight: FontWeight.w700), maxLines: 1, overflow: TextOverflow.ellipsis),
      subtitle: Text('${item.modeLabel} · ${item.questions} questions · ${whenLabel(item.submittedAt)}'),
      trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
        Text('${item.score % 1 == 0 ? item.score.toInt() : item.score}/${item.maxScore % 1 == 0 ? item.maxScore.toInt() : item.maxScore}', style: const TextStyle(fontWeight: FontWeight.w700)),
        Text('$pct%', style: const TextStyle(color: Palette.ink2, fontSize: 12)),
      ]),
    );
  }
}
