import 'package:flutter/material.dart';

import '../../core/app_scope.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import '../../data/models.dart';
import '../shell/app_shell.dart';
import 'test_player.dart';
import 'test_review_screen.dart';

/// Shows the instructions, then opens the player. Used by the home page and the list.
Future<void> openTest(BuildContext context, TestInfo t) async {
  final go = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(t.title),
      content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        _Fact(Icons.help_outline, '${t.questionCount} questions'),
        _Fact(Icons.timer_outlined, '${t.durationMin} minutes once you start'),
        _Fact(Icons.event, 'Closes ${formatDue(t.closesAt)}'),
        if (t.negativeMarks > 0) _Fact(Icons.remove_circle_outline,
              '${t.negativeMarks % 1 == 0 ? t.negativeMarks.toInt() : t.negativeMarks} mark taken off for each wrong answer'),
        if (t.instructions != null) ...[const SizedBox(height: 10), Text(t.instructions!)],
        const SizedBox(height: 10),
        const Text('Your answers are saved on the tablet as you go. The timer keeps running on the server for online tests.',
            style: TextStyle(color: Palette.ink2, fontSize: 13)),
      ]),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Not now')),
        FilledButton(onPressed: () => Navigator.pop(ctx, true), child: Text(t.attempt == null ? 'Start' : 'Continue')),
      ],
    ),
  );
  if (go == true && context.mounted) {
    await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => TestPlayer(test: t), fullscreenDialog: true));
  }
}

class _Fact extends StatelessWidget {
  const _Fact(this.icon, this.text);
  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Row(children: [Icon(icon, size: 18, color: Palette.ink2), const SizedBox(width: 8), Expanded(child: Text(text))]),
      );
}

class TestsPage extends StatelessWidget {
  const TestsPage({super.key});

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final open = app.testList.where((t) => t.state == 'open' && !(t.attempt?.submitted ?? false)).toList();
    final upcoming = app.testList.where((t) => t.state == 'upcoming').toList();
    final done = app.testList.where((t) => t.attempt?.submitted ?? false).toList();
    final missed = app.testList.where((t) => t.state == 'closed' && !(t.attempt?.submitted ?? false)).toList();

    List<Widget> section(String title, List<TestInfo> list) => [
          if (list.isNotEmpty) ...[
            const SizedBox(height: 18),
            Text(title, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            for (final t in list) Padding(padding: const EdgeInsets.only(bottom: 8), child: _TestCard(test: t)),
          ],
        ];

    return PageBody(children: [
      if (app.pendingUploads > 0)
        Card(
          color: Palette.warnSoft,
          child: ListTile(
            leading: const Icon(Icons.cloud_upload_outlined, color: Palette.warn),
            title: Text('${app.pendingUploads} finished test${app.pendingUploads == 1 ? '' : 's'} waiting to upload'),
            subtitle: const Text('They upload automatically when the tablet is back on Wi-Fi.'),
            trailing: TextButton(onPressed: app.sync, child: const Text('Upload now')),
          ),
        ),
      if (app.testList.isEmpty)
        const EmptyState(icon: Icons.assignment_outlined, title: 'No tests yet', message: 'Tests from your teachers will appear here.')
      else ...[
        ...section('Open now', open),
        ...section('Upcoming', upcoming),
        ...section('Completed', done),
        ...section('Missed', missed),
      ],
    ]);
  }
}

class _TestCard extends StatelessWidget {
  const _TestCard({required this.test});
  final TestInfo test;

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final a = test.attempt;
    final paperSaved = app.downloadedPapers.contains(test.id);

    Widget status;
    if (a?.submitted ?? false) {
      status = switch (a!.reviewStatus) {
        'PENDING' => const Pill('Awaiting teacher review', tone: PillTone.warn),
        'REJECTED' => const Pill('Not accepted', tone: PillTone.bad),
        _ => a.percent != null ? Pill('Scored ${formatPercent(a.percent)}', tone: PillTone.ok) : const Pill('Submitted', tone: PillTone.ok),
      };
    } else if (test.state == 'open') {
      status = a != null ? const Pill('In progress', tone: PillTone.warn) : Pill('Closes ${formatDue(test.closesAt)}', tone: PillTone.warn);
    } else if (test.state == 'upcoming') {
      status = Pill('Opens ${formatDue(test.opensAt)}');
    } else {
      status = const Pill('Closed');
    }

    final actions = <Widget>[
      if (test.canStart) FilledButton(onPressed: () => openTest(context, test), child: Text(a == null ? 'Start' : 'Continue')),
      if (test.allowOffline && !(a?.submitted ?? false) && test.state != 'closed')
        paperSaved
            ? const Pill('Ready offline', tone: PillTone.board, icon: Icons.download_done)
            : OutlinedButton.icon(
                icon: const Icon(Icons.download_outlined, size: 18),
                label: const Text('Download for offline'),
                onPressed: () async {
                  try {
                    await app.downloadPaper(test);
                    if (context.mounted) showSnack(context, 'Saved. You can take this test without Wi-Fi.');
                  } catch (e) {
                    if (context.mounted) showSnack(context, friendlyError(e));
                  }
                },
              ),
      if (a?.reviewAvailable ?? false)
        OutlinedButton(
          onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => TestReviewScreen(test: test))),
          child: const Text('See answers'),
        ),
    ];

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            SubjectBadge(code: test.subjectCode, icon: Icons.assignment_outlined),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(test.title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                Text('${test.subjectName} · ${test.questionCount} questions · ${test.durationMin} min',
                    style: const TextStyle(color: Palette.ink2, fontSize: 13)),
                const SizedBox(height: 8),
                status,
              ]),
            ),
          ]),
          if (actions.isNotEmpty) ...[
            const SizedBox(height: 12),
            Wrap(spacing: 8, runSpacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: actions),
          ],
        ]),
      ),
    );
  }
}
