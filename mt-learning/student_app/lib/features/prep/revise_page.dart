import 'package:flutter/material.dart';

import '../../core/app_scope.dart';
import '../../core/math_text.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import '../../data/api_client.dart';
import '../../data/prep_models.dart';
import 'attempt_screen.dart';
import '../shell/app_shell.dart';
import 'exam_choice.dart';

/// Revise: retry questions answered wrong, and practise saved (bookmarked) questions.
class RevisePage extends StatefulWidget {
  const RevisePage({super.key});

  @override
  State<RevisePage> createState() => _RevisePageState();
}

class _RevisePageState extends State<RevisePage> {
  Future<List<BookmarkItem>>? _bookmarks;
  String? _examId;

  void _load(String examId) {
    _examId = examId;
    _bookmarks = AppScope.read(context).prepApi.bookmarks(examId);
  }

  Future<void> _remove(BookmarkItem b) async {
    try {
      await AppScope.read(context).prepApi.removeBookmark(b.questionId);
      if (!mounted) return;
      setState(() => _load(_examId!));
      showSnack(context, 'Removed from saved questions');
    } catch (e) {
      if (mounted) showSnack(context, friendlyError(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final exam = app.exam;
    if (exam == null) return const PageBody(children: [ExamChoice()]);
    if (_examId != exam.id) _load(exam.id);
    final d = app.prepDashboard;
    final wrong = d?.wrongCount ?? 0;
    final saved = d?.bookmarksCount ?? 0;

    Future<void> go(Future<Object> Function() load) async {
      await runAttempt(context, load);
      if (mounted) setState(() => _load(exam.id));
    }

    final cards = [
      _ReviseCard(
        tile: 4,
        icon: Icons.replay_rounded,
        title: 'Fix wrong answers',
        detail: wrong == 0 ? 'Nothing to fix yet. Questions you get wrong come here.' : '$wrong question${wrong == 1 ? '' : 's'} you got wrong last time',
        button: 'Retry 10',
        onTap: wrong == 0 ? null : () => go(() => app.prepApi.reviseWrong(exam.id)),
      ),
      _ReviseCard(
        tile: 2,
        icon: Icons.bookmark_rounded,
        title: 'Saved questions',
        detail: saved == 0 ? 'Tap the bookmark on any question in a result to save it.' : '$saved saved question${saved == 1 ? '' : 's'}',
        button: 'Practise 10',
        onTap: saved == 0 ? null : () => go(() => app.prepApi.reviseBookmarks(exam.id)),
      ),
    ];

    return PageBody(maxWidth: 960, children: [
      Text('Revise', style: Theme.of(context).textTheme.headlineSmall),
      const Text('Short sets that bring back what you got wrong or chose to save.', style: TextStyle(color: Palette.ink2)),
      const SizedBox(height: 16),
      LayoutBuilder(builder: (context, c) {
        if (c.maxWidth < 620) return Column(children: [cards[0], const SizedBox(height: 12), cards[1]]);
        return Row(crossAxisAlignment: CrossAxisAlignment.start, children: [Expanded(child: cards[0]), const SizedBox(width: 12), Expanded(child: cards[1])]);
      }),
      const SizedBox(height: 24),
      const SectionTitle('Saved questions'),
      const SizedBox(height: 8),
      FutureBuilder<List<BookmarkItem>>(
        future: _bookmarks,
        builder: (context, snap) {
          if (snap.hasError) {
            return EmptyState(
              icon: Icons.cloud_off,
              title: 'Could not load saved questions',
              message: snap.error is OfflineException ? 'Connect to Wi-Fi and try again.' : friendlyError(snap.error!),
              action: FilledButton(onPressed: () => setState(() => _load(exam.id)), child: const Text('Try again')),
            );
          }
          final items = snap.data;
          if (items == null) return const Padding(padding: EdgeInsets.all(30), child: Center(child: CircularProgressIndicator()));
          if (items.isEmpty) return const EmptyState(icon: Icons.bookmark_border, title: 'No saved questions yet');
          return Card(
            child: Column(children: [
              for (final (i, b) in items.indexed) ...[
                if (i > 0) const Divider(),
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 12, 6, 12),
                  child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text('${b.subjectName} · ${b.chapterName}', style: const TextStyle(color: Palette.ink2, fontSize: 12.5, fontWeight: FontWeight.w700)),
                        const SizedBox(height: 4),
                        MathText(b.text.length > 280 ? '${b.text.substring(0, 280)}…' : b.text, style: const TextStyle(color: Palette.ink, fontSize: 15)),
                      ]),
                    ),
                    IconButton(tooltip: 'Remove', onPressed: () => _remove(b), icon: const Icon(Icons.bookmark_remove_outlined)),
                  ]),
                ),
              ],
            ]),
          );
        },
      ),
    ]);
  }
}

class _ReviseCard extends StatelessWidget {
  const _ReviseCard({required this.tile, required this.icon, required this.title, required this.detail, required this.button, required this.onTap});
  final int tile;
  final IconData icon;
  final String title;
  final String detail;
  final String button;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final colors = Palette.tiles[tile % Palette.tiles.length];
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(gradient: LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: colors), borderRadius: BorderRadius.circular(18)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Icon(icon, color: Colors.white, size: 30),
        const SizedBox(height: 10),
        Text(title, style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w700)),
        const SizedBox(height: 2),
        Text(detail, style: TextStyle(color: Colors.white.withValues(alpha: 0.9))),
        const SizedBox(height: 14),
        FilledButton(
          style: FilledButton.styleFrom(backgroundColor: Colors.white, foregroundColor: colors.last, disabledBackgroundColor: Colors.white.withValues(alpha: 0.35)),
          onPressed: onTap,
          child: Text(button),
        ),
      ]),
    );
  }
}
