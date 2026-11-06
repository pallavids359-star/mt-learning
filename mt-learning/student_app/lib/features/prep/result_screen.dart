import 'package:flutter/material.dart';

import '../../core/app_scope.dart';
import '../../core/format.dart';
import '../../core/math_text.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import '../../data/prep_models.dart';

String _n(double v) => v % 1 == 0 ? v.toInt().toString() : v.toStringAsFixed(2);
String _mins(int sec) => sec < 60 ? '${sec}s' : '${sec ~/ 60}m ${sec % 60}s';

/// Score, subject breakdown and a full answer review with explanations.
class ResultScreen extends StatefulWidget {
  const ResultScreen({super.key, required this.review, this.note});
  final PrepReview review;
  final String? note;

  @override
  State<ResultScreen> createState() => _ResultScreenState();
}

enum _Filter { all, wrong, skipped, right }

class _ResultScreenState extends State<ResultScreen> {
  _Filter _filter = _Filter.all;

  @override
  Widget build(BuildContext context) {
    final r = widget.review.result;
    final items = widget.review.items.where((i) => switch (_filter) {
          _Filter.all => true,
          _Filter.wrong => i.isCorrect == false,
          _Filter.skipped => i.isCorrect == null,
          _Filter.right => i.isCorrect == true,
        });
    final pct = r.percentage;
    final ringColor = pct >= 60 ? Palette.ok : (pct >= 35 ? Palette.warn : Palette.bad);
    final wide = MediaQuery.sizeOf(context).width >= 900;

    final summary = Container(
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        color: Palette.board,
        borderRadius: BorderRadius.circular(18),
      ),
      child: Row(children: [
        Container(
          decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle),
          padding: const EdgeInsets.all(6),
          child: Ring(percent: pct.clamp(0, 100).toDouble(), label: 'score', color: ringColor, size: 110),
        ),
        const SizedBox(width: 20),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(widget.review.title, style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w700)),
            const SizedBox(height: 4),
            Text('${_n(r.score)} / ${_n(r.maxScore)} marks', style: TextStyle(color: Colors.white.withValues(alpha: 0.92), fontSize: 16, fontWeight: FontWeight.w700)),
            const SizedBox(height: 12),
            Wrap(spacing: 8, runSpacing: 8, children: [
              _Chip('${r.correct} correct', const Color(0xFF7FE0B0)),
              _Chip('${r.incorrect} wrong', const Color(0xFFFFA59A)),
              _Chip('${r.unanswered} skipped', const Color(0xFFC9D4E6)),
              _Chip('Accuracy ${_n(r.accuracy)}%', const Color(0xFFFFD27A)),
              _Chip('Time ${_mins(r.timeTakenSec)}', const Color(0xFFC9D4E6)),
            ]),
          ]),
        ),
      ]),
    );

    final subjects = r.subjects.length < 2
        ? const SizedBox.shrink()
        : Card(
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Text('By subject', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 10),
                for (final s in r.subjects)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: Row(children: [
                      SubjectBadge(code: s.name.length >= 3 ? s.name.substring(0, 3).toUpperCase() : s.name, size: 36),
                      const SizedBox(width: 10),
                      Expanded(child: Text(s.name, style: const TextStyle(fontWeight: FontWeight.w700))),
                      Text('${_n(s.score)} marks', style: const TextStyle(fontWeight: FontWeight.w600)),
                      const SizedBox(width: 10),
                      Text('${s.correct}✓  ${s.incorrect}✗  ${s.unanswered}–', style: const TextStyle(color: Palette.ink2)),
                    ]),
                  ),
              ]),
            ),
          );

    return Scaffold(
      appBar: AppBar(title: const Text('Result')),
      body: ListView(padding: const EdgeInsets.all(20), children: [
        Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 900),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              if (widget.note != null || widget.review.status == 'auto_submitted')
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: Pill(widget.note ?? 'Submitted automatically when time ran out', tone: PillTone.warn, icon: Icons.timer_off_outlined),
                ),
              summary,
              const SizedBox(height: 14),
              if (wide) Row(crossAxisAlignment: CrossAxisAlignment.start, children: [Expanded(child: subjects)]) else subjects,
              const SizedBox(height: 18),
              Row(children: [
                Expanded(child: Text('Review answers', style: Theme.of(context).textTheme.titleLarge)),
              ]),
              const SizedBox(height: 10),
              Wrap(spacing: 8, runSpacing: 8, children: [
                for (final f in _Filter.values)
                  ChoiceChip(
                    label: Text(switch (f) {
                      _Filter.all => 'All ${widget.review.items.length}',
                      _Filter.wrong => 'Wrong ${r.incorrect}',
                      _Filter.skipped => 'Skipped ${r.unanswered}',
                      _Filter.right => 'Correct ${r.correct}',
                    }),
                    selected: _filter == f,
                    onSelected: (_) => setState(() => _filter = f),
                  ),
              ]),
              const SizedBox(height: 12),
              for (final i in items) Padding(padding: const EdgeInsets.only(bottom: 12), child: ReviewCard(item: i)),
              if (items.isEmpty) const EmptyState(icon: Icons.check_circle_outline, title: 'Nothing here'),
              const SizedBox(height: 8),
              FilledButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Done')),
            ]),
          ),
        ),
      ]),
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip(this.label, this.color);
  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(99), border: Border.all(color: color.withValues(alpha: 0.6))),
        child: Text(label, style: TextStyle(color: color, fontWeight: FontWeight.w600, fontSize: 12.5)),
      );
}

/// One question in a review: your answer, the right answer, the explanation, and a bookmark.
class ReviewCard extends StatefulWidget {
  const ReviewCard({super.key, required this.item});
  final ReviewItem item;

  @override
  State<ReviewCard> createState() => _ReviewCardState();
}

class _ReviewCardState extends State<ReviewCard> {
  bool _busy = false;
  bool _open = false;

  Future<void> _toggleBookmark() async {
    final i = widget.item;
    final api = AppScope.read(context).prepApi;
    setState(() => _busy = true);
    try {
      if (i.bookmarked) {
        await api.removeBookmark(i.questionId);
      } else {
        await api.addBookmark(i.questionId);
      }
      setState(() => i.bookmarked = !i.bookmarked);
    } catch (e) {
      if (mounted) showSnack(context, friendlyError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final i = widget.item;
    final (label, tone) = switch (i.isCorrect) {
      true => ('Correct  +${_n(i.marksAwarded)}', PillTone.ok),
      false => ('Wrong  ${_n(i.marksAwarded)}', PillTone.bad),
      null => ('Skipped', PillTone.neutral),
    };
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Text('Q${i.number}', style: const TextStyle(fontWeight: FontWeight.w700, color: Palette.ink2)),
            const SizedBox(width: 8),
            Pill(label, tone: tone),
            const SizedBox(width: 8),
            Expanded(child: Text(i.chapterName, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Palette.ink3, fontSize: 12.5))),
            Text(_mins(i.timeSec), style: const TextStyle(color: Palette.ink3, fontSize: 12.5)),
            IconButton(
              tooltip: i.bookmarked ? 'Remove bookmark' : 'Bookmark to revise later',
              onPressed: _busy ? null : _toggleBookmark,
              icon: Icon(i.bookmarked ? Icons.bookmark : Icons.bookmark_border, color: i.bookmarked ? Palette.marigold : Palette.ink3),
            ),
          ]),
          const SizedBox(height: 6),
          MathText(i.text, images: i.images, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: Palette.ink, height: 1.4)),
          const SizedBox(height: 10),
          if (i.type == 'numerical')
            Wrap(spacing: 10, runSpacing: 8, children: [
              Pill('Your answer: ${i.numerical == null ? '—' : _n(i.numerical!)}', tone: i.isCorrect == true ? PillTone.ok : PillTone.bad),
              Pill('Correct: ${i.numericalAnswer == null ? '—' : _n(i.numericalAnswer!)}', tone: PillTone.ok),
            ])
          else
            for (final o in i.options) _ReviewOption(option: o, correct: i.correctOptionIds.contains(o.id), chosen: i.selected.contains(o.id)),
          if (i.explanation.isNotEmpty || i.explanationImages.isNotEmpty) ...[
            const SizedBox(height: 6),
            InkWell(
              onTap: () => setState(() => _open = !_open),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 6),
                child: Row(children: [
                  Icon(_open ? Icons.expand_less : Icons.lightbulb_outline, size: 18, color: Palette.teal),
                  const SizedBox(width: 6),
                  Text(_open ? 'Hide explanation' : 'Show explanation', style: const TextStyle(color: Palette.teal, fontWeight: FontWeight.w600)),
                ]),
              ),
            ),
            if (_open)
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(color: Palette.marigoldSoft, borderRadius: BorderRadius.circular(12)),
                child: MathText(i.explanation, images: i.explanationImages, style: const TextStyle(color: Palette.ink, height: 1.45)),
              ),
          ],
        ]),
      ),
    );
  }
}

class _ReviewOption extends StatelessWidget {
  const _ReviewOption({required this.option, required this.correct, required this.chosen});
  final PrepOption option;
  final bool correct;
  final bool chosen;

  @override
  Widget build(BuildContext context) {
    final wrong = chosen && !correct;
    return Container(
      margin: const EdgeInsets.only(bottom: 6),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: correct ? Palette.okSoft : (wrong ? Palette.badSoft : null),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: correct ? Palette.ok : (wrong ? Palette.bad : Palette.line)),
      ),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('${option.id}.  ', style: const TextStyle(fontWeight: FontWeight.w700)),
        Expanded(child: MathText(option.text, images: [if (option.image != null) option.image!])),
        if (chosen) Padding(padding: const EdgeInsets.only(left: 6), child: Text('Your answer', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: correct ? Palette.ok : Palette.bad))),
        if (correct) const Padding(padding: EdgeInsets.only(left: 6), child: Icon(Icons.check_circle, color: Palette.ok, size: 18)),
        if (wrong) const Padding(padding: EdgeInsets.only(left: 6), child: Icon(Icons.cancel, color: Palette.bad, size: 18)),
      ]),
    );
  }
}

/// Small helper used by pages that show a mode label.
String modeLabel(String mode) => switch (mode) { 'mock' => 'Mock test', 'wrong' => 'Wrong answers', 'bookmark' => 'Bookmarks', _ => 'Practice' };

String whenLabel(DateTime? d) => d == null ? '' : formatAgo(d);
