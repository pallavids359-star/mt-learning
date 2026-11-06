import 'package:flutter/material.dart';

import '../../core/app_scope.dart';
import '../../core/format.dart';
import '../../core/math_text.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import '../../data/models.dart';

/// Correct answers and explanations, available once the test has closed.
class TestReviewScreen extends StatefulWidget {
  const TestReviewScreen({super.key, required this.test});
  final TestInfo test;

  @override
  State<TestReviewScreen> createState() => _TestReviewScreenState();
}

class _TestReviewScreenState extends State<TestReviewScreen> {
  late Future<TestReview> _review;
  bool _onlyWrong = false;

  @override
  void initState() {
    super.initState();
    _review = AppScope.read(context).tests.review(widget.test.id);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.test.title)),
      body: FutureBuilder<TestReview>(
        future: _review,
        builder: (context, snap) {
          if (snap.hasError) {
            return Padding(
              padding: const EdgeInsets.all(24),
              child: EmptyState(icon: Icons.cloud_off, title: 'Answers could not load', message: friendlyError(snap.error!)),
            );
          }
          final r = snap.data;
          if (r == null) return const Center(child: CircularProgressIndicator());
          final qs = _onlyWrong ? r.questions.where((q) => q.yourAnswer != q.correctIndex).toList() : r.questions;
          return ListView(padding: const EdgeInsets.all(20), children: [
            Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 820),
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Row(children: [
                    Ring(percent: r.percent, label: 'score', size: 96),
                    const SizedBox(width: 18),
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text('${r.questions.where((q) => q.yourAnswer == q.correctIndex).length} of ${r.questions.length} correct',
                            style: Theme.of(context).textTheme.titleLarge),
                        if (r.score != null) Text('${r.score} / ${r.maxScore} marks', style: const TextStyle(color: Palette.ink2)),
                      ]),
                    ),
                  ]),
                  const SizedBox(height: 14),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('Show only questions I got wrong'),
                    value: _onlyWrong,
                    onChanged: (v) => setState(() => _onlyWrong = v),
                  ),
                  const SizedBox(height: 8),
                  for (final q in qs) Padding(padding: const EdgeInsets.only(bottom: 12), child: _ReviewCard(q: q)),
                  if (qs.isEmpty) const EmptyState(icon: Icons.emoji_events_outlined, title: 'No wrong answers. Excellent!'),
                ]),
              ),
            ),
          ]);
        },
      ),
    );
  }
}

class _ReviewCard extends StatelessWidget {
  const _ReviewCard({required this.q});
  final ReviewQuestion q;

  @override
  Widget build(BuildContext context) {
    final correct = q.yourAnswer == q.correctIndex;
    final skipped = q.yourAnswer == null;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Text('Q${q.position}', style: const TextStyle(fontWeight: FontWeight.w600, color: Palette.ink2)),
            const SizedBox(width: 8),
            skipped
                ? const Pill('Not answered')
                : (correct ? const Pill('Correct', tone: PillTone.ok) : const Pill('Wrong', tone: PillTone.bad)),
            if (q.topic != null) ...[const SizedBox(width: 8), Pill(q.topic!, tone: PillTone.board)],
          ]),
          const SizedBox(height: 10),
          MathText(q.text, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: Palette.ink)),
          const SizedBox(height: 10),
          for (var i = 0; i < q.options.length; i++)
            Container(
              margin: const EdgeInsets.only(bottom: 6),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
              decoration: BoxDecoration(
                color: i == q.correctIndex ? Palette.okSoft : (i == q.yourAnswer ? Palette.badSoft : null),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: i == q.correctIndex ? Palette.ok : (i == q.yourAnswer ? Palette.bad : Palette.line)),
              ),
              child: Row(children: [
                Text('${String.fromCharCode(65 + i)}.  ', style: const TextStyle(fontWeight: FontWeight.w700)),
                Expanded(child: MathText(q.options[i], style: const TextStyle(color: Palette.ink))),
                if (i == q.correctIndex) const Icon(Icons.check, color: Palette.ok, size: 18),
                if (i == q.yourAnswer && i != q.correctIndex) const Icon(Icons.close, color: Palette.bad, size: 18),
              ]),
            ),
          if (q.explanation != null) ...[
            const SizedBox(height: 6),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: Palette.marigoldSoft, borderRadius: BorderRadius.circular(12)),
              child: MathText(q.explanation!, style: const TextStyle(color: Palette.ink)),
            ),
          ],
        ]),
      ),
    );
  }
}

String reviewLabel(AttemptInfo a) => a.percent == null ? 'Submitted' : formatPercent(a.percent);
