import 'package:flutter/material.dart';

import '../../core/app_scope.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import '../../data/api_client.dart';
import '../../data/prep_models.dart';
import '../shell/app_shell.dart';
import 'attempt_screen.dart';
import 'exam_choice.dart';

/// Practice, Navy & Gold design: 1. class, 2. subject, 3. chapters (tap a chapter for its
/// topics), and a "Your practice" panel on the right with difficulty, size and Start.
class PracticePage extends StatefulWidget {
  const PracticePage({super.key});

  @override
  State<PracticePage> createState() => _PracticePageState();
}

class _PracticePageState extends State<PracticePage> {
  Future<List<SyllabusSubject>>? _syllabus;
  String? _examId;
  int _subject = 0;
  String? _level; // '11', '12' or 'both'
  String _difficulty = 'any';
  int _count = 20;
  final Set<String> _picked = {};
  final Set<String> _open = {};
  final Map<String, Set<String>> _topics = {};
  final Map<String, Future<List<PrepTopic>>> _topicLists = {};
  final Map<String, String> _names = {};

  void _load(String examId) {
    _examId = examId;
    _syllabus = AppScope.read(context).prepApi.syllabus(examId);
    _picked.clear();
    _open.clear();
    _topics.clear();
    _subject = 0;
  }

  void _clearPicks() {
    _picked.clear();
    _topics.clear();
  }

  void _toggleChapter(SyllabusChapter c) => setState(() {
        _names[c.id] = c.name;
        if (_picked.remove(c.id)) {
          _topics.remove(c.id);
        } else {
          _picked.add(c.id);
        }
      });

  void _toggleTopic(SyllabusChapter c, String topicId) => setState(() {
        _names[c.id] = c.name;
        final set = _topics.putIfAbsent(c.id, () => {});
        if (!set.remove(topicId)) set.add(topicId);
        if (set.isNotEmpty) _picked.add(c.id);
      });

  Future<List<PrepTopic>> _topicsOf(String chapterId) =>
      _topicLists.putIfAbsent(chapterId, () => AppScope.read(context).prepApi.topics(chapterId));

  Future<void> _start(PrepExam exam) async {
    final chapters = _picked.toList();
    final topicIds = [for (final id in chapters) ...?_topics[id]];
    final api = AppScope.read(context).prepApi;
    await runAttempt(context, () => api.practice(examId: exam.id, chapterIds: chapters, topicIds: topicIds, difficulty: _difficulty, count: _count));
    if (mounted) setState(() => _load(exam.id)); // accuracy changed
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final exam = app.exam;
    if (exam == null) return const PageBody(children: [ExamChoice()]);
    if (_examId != exam.id) _load(exam.id);
    _level ??= app.home?.profile.pucYear == 'PUC_2' ? '12' : '11';

    return PageBody(maxWidth: 1240, children: [
      FutureBuilder<List<SyllabusSubject>>(
        future: _syllabus,
        builder: (context, snap) {
          if (snap.hasError) {
            return EmptyState(
              icon: Icons.cloud_off,
              title: 'Chapters could not load',
              message: snap.error is OfflineException ? 'Practice needs Wi-Fi. Connect and try again.' : friendlyError(snap.error!),
              action: FilledButton(onPressed: () => setState(() => _load(exam.id)), child: const Text('Try again')),
            );
          }
          final subjects = snap.data;
          if (subjects == null) return const Padding(padding: EdgeInsets.all(40), child: Center(child: CircularProgressIndicator()));
          if (subjects.isEmpty) return const EmptyState(icon: Icons.menu_book_outlined, title: 'No chapters yet');
          final s = subjects[_subject.clamp(0, subjects.length - 1)];

          final steps = Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            const _StepLabel('1. Class'),
            _CardRow(children: [
              for (final (v, t, sub) in const [('11', 'Class 11', '1st PUC chapters'), ('12', 'Class 12', '2nd PUC chapters'), ('both', 'Class 11 + 12', 'Both years')])
                _ClassCard(
                  title: t,
                  subtitle: sub,
                  selected: _level == v,
                  onTap: () => setState(() {
                    _level = v;
                    _clearPicks();
                  }),
                ),
            ]),
            const SizedBox(height: 20),
            const _StepLabel('2. Subject'),
            _CardRow(children: [
              for (final (i, x) in subjects.indexed)
                _SubjectCard(
                  name: x.name,
                  status: _subjectStatus(x),
                  selected: i == _subject,
                  onTap: () => setState(() => _subject = i),
                ),
            ]),
            const SizedBox(height: 20),
            for (final level in (_level == 'both' ? const ['11', '12'] : [_level!])) ...[
              _ChapterCard(
                title: '${_level == 'both' ? '' : '3. '}Class $level ${s.name} chapters',
                chapters: s.chapters.where((c) => c.classLevel == level).toList(),
                subjectName: s.name,
                level: level,
                picked: _picked,
                open: _open,
                topics: _topics,
                topicsOf: _topicsOf,
                onTick: _toggleChapter,
                onOpen: (c) => setState(() => _open.contains(c.id) ? _open.remove(c.id) : _open.add(c.id)),
                onTopic: _toggleTopic,
                onAll: (list) => setState(() {
                  final ids = list.where((c) => c.questionCount > 0).toList();
                  if (ids.every((c) => _picked.contains(c.id))) {
                    for (final c in ids) {
                      _picked.remove(c.id);
                      _topics.remove(c.id);
                    }
                  } else {
                    for (final c in ids) {
                      _picked.add(c.id);
                      _names[c.id] = c.name;
                    }
                  }
                }),
              ),
              const SizedBox(height: 14),
            ],
          ]);

          final summary = _Summary(
            exam: exam,
            levelLabel: _level == 'both' ? 'Class 11 + 12' : 'Class $_level',
            chosen: [for (final id in _picked) (_names[id] ?? 'Chapter', _topics[id]?.length ?? 0)],
            difficulty: _difficulty,
            count: _count,
            onDifficulty: (v) => setState(() => _difficulty = v),
            onCount: (v) => setState(() => _count = v),
            onClear: () => setState(_clearPicks),
            onStart: _picked.isEmpty ? null : () => _start(exam),
          );

          return LayoutBuilder(builder: (context, c) {
            if (c.maxWidth >= 900) {
              return Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Expanded(child: steps),
                const SizedBox(width: 18),
                SizedBox(width: 300, child: summary),
              ]);
            }
            return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Align(
                alignment: Alignment.centerRight,
                child: TextButton.icon(onPressed: () => changeExam(context), icon: const Icon(Icons.swap_horiz), label: Text('${exam.code} · Change exam')),
              ),
              steps,
              const SizedBox(height: 6),
              summary,
            ]);
          });
        },
      ),
    ]);
  }

  /// "42% accuracy" across the subject's chapters, or "Not started".
  static String _subjectStatus(SyllabusSubject s) {
    var answered = 0;
    var right = 0.0;
    for (final c in s.chapters) {
      if (c.attempted > 0 && c.accuracy != null) {
        answered += c.attempted;
        right += c.attempted * c.accuracy! / 100;
      }
    }
    if (answered == 0) return 'Not started';
    return '${(right / answered * 100).round()}% accuracy';
  }
}

class _StepLabel extends StatelessWidget {
  const _StepLabel(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: Text(text.toUpperCase(), style: const TextStyle(color: Palette.ink2, fontSize: 12.5, fontWeight: FontWeight.w700, letterSpacing: 0.8)),
      );
}

/// Cards side by side in equal widths.
class _CardRow extends StatelessWidget {
  const _CardRow({required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        for (final (i, w) in children.indexed) ...[
          if (i > 0) const SizedBox(width: 10),
          Expanded(child: w),
        ],
      ]);
}

class _ClassCard extends StatelessWidget {
  const _ClassCard({required this.title, required this.subtitle, required this.selected, required this.onTap});
  final String title;
  final String subtitle;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? Palette.board : Palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14), side: BorderSide(color: selected ? Palette.board : Palette.line, width: 1.5)),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(title, style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16, color: selected ? Colors.white : Palette.ink)),
            const SizedBox(height: 2),
            Text(subtitle, style: TextStyle(fontSize: 12.5, color: selected ? Palette.menuText : Palette.ink2)),
          ]),
        ),
      ),
    );
  }
}

class _SubjectCard extends StatelessWidget {
  const _SubjectCard({required this.name, required this.status, required this.selected, required this.onTap});
  final String name;
  final String status;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final code = name.substring(0, name.length.clamp(0, 3)).toUpperCase();
    final color = Palette.subject(code);
    return Material(
      color: selected ? const Color(0xFFF4F6FA) : Palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14), side: BorderSide(color: selected ? Palette.board : Palette.line, width: selected ? 2 : 1.5)),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(children: [
            Container(
              width: 42,
              height: 42,
              alignment: Alignment.center,
              decoration: BoxDecoration(color: color.withValues(alpha: 0.13), borderRadius: BorderRadius.circular(11)),
              child: Text(code, style: TextStyle(color: color, fontWeight: FontWeight.w800, fontSize: 13)),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15.5)),
                Text(status, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Palette.ink2, fontSize: 12.5)),
              ]),
            ),
          ]),
        ),
      ),
    );
  }
}

class _ChapterCard extends StatelessWidget {
  const _ChapterCard({
    required this.title,
    required this.chapters,
    required this.subjectName,
    required this.level,
    required this.picked,
    required this.open,
    required this.topics,
    required this.topicsOf,
    required this.onTick,
    required this.onOpen,
    required this.onTopic,
    required this.onAll,
  });
  final String title;
  final List<SyllabusChapter> chapters;
  final String subjectName;
  final String level;
  final Set<String> picked;
  final Set<String> open;
  final Map<String, Set<String>> topics;
  final Future<List<PrepTopic>> Function(String) topicsOf;
  final ValueChanged<SyllabusChapter> onTick;
  final ValueChanged<SyllabusChapter> onOpen;
  final void Function(SyllabusChapter, String) onTopic;
  final ValueChanged<List<SyllabusChapter>> onAll;

  @override
  Widget build(BuildContext context) {
    final usable = chapters.where((c) => c.questionCount > 0);
    final allOn = usable.isNotEmpty && usable.every((c) => picked.contains(c.id));
    return Card(
      clipBehavior: Clip.antiAlias,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(18, 12, 10, 12),
          child: Row(children: [
            Expanded(child: Text(title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16))),
            if (usable.isNotEmpty) TextButton(onPressed: () => onAll(chapters), child: Text(allOn ? 'Clear all' : 'Select all')),
          ]),
        ),
        const Divider(),
        if (chapters.isEmpty)
          Padding(
            padding: const EdgeInsets.all(18),
            child: Text('No Class $level $subjectName chapters yet.', style: const TextStyle(color: Palette.ink2)),
          ),
        for (final (i, c) in chapters.indexed) ...[
          if (i > 0) const Divider(),
          _ChapterRow(
            chapter: c,
            picked: picked.contains(c.id),
            open: open.contains(c.id),
            topicCount: topics[c.id]?.length ?? 0,
            onTick: c.questionCount == 0 ? null : () => onTick(c),
            onOpen: c.questionCount == 0 ? null : () => onOpen(c),
            topicPanel: open.contains(c.id)
                ? _TopicPanel(topics: topicsOf(c.id), picked: topics[c.id] ?? const {}, onToggle: (t) => onTopic(c, t))
                : null,
          ),
        ],
      ]),
    );
  }
}

class _ChapterRow extends StatelessWidget {
  const _ChapterRow({required this.chapter, required this.picked, required this.open, required this.topicCount, required this.onTick, required this.onOpen, this.topicPanel});
  final SyllabusChapter chapter;
  final bool picked;
  final bool open;
  final int topicCount;
  final VoidCallback? onTick;
  final VoidCallback? onOpen;
  final Widget? topicPanel;

  @override
  Widget build(BuildContext context) {
    final c = chapter;
    final acc = c.attempted > 0 ? c.accuracy : null;
    final status = c.questionCount == 0
        ? 'No questions yet'
        : topicCount > 0
            ? '$topicCount topic${topicCount == 1 ? '' : 's'} chosen'
            : (c.attempted > 0 ? '${c.attempted} answered' : 'Not started');
    return Container(
      color: picked ? const Color(0xFFFBF8EF) : null,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        InkWell(
          onTap: onOpen,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(8, 6, 16, 6),
            child: Row(children: [
              Checkbox(value: picked, onChanged: onTick == null ? null : (_) => onTick!()),
              const SizedBox(width: 4),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(c.name, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                    const SizedBox(height: 2),
                    Text(status, style: TextStyle(color: topicCount > 0 ? Palette.goldInk : Palette.ink2, fontSize: 12.5)),
                  ]),
                ),
              ),
              const SizedBox(width: 12),
              SizedBox(
                width: 110,
                child: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                  ClipRRect(
                    borderRadius: BorderRadius.circular(99),
                    child: LinearProgressIndicator(
                      value: (acc ?? 0) / 100,
                      minHeight: 6,
                      color: Palette.gold,
                      backgroundColor: const Color(0xFFECEEF2),
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(acc == null ? '—' : '$acc% right', style: const TextStyle(color: Palette.ink2, fontSize: 11.5)),
                ]),
              ),
              const SizedBox(width: 10),
              Icon(open ? Icons.expand_less : Icons.expand_more, color: onOpen == null ? Palette.line : Palette.ink3),
            ]),
          ),
        ),
        if (topicPanel != null) topicPanel!,
      ]),
    );
  }
}

/// A chapter's topics as chips. None ticked means the whole chapter.
class _TopicPanel extends StatelessWidget {
  const _TopicPanel({required this.topics, required this.picked, required this.onToggle});
  final Future<List<PrepTopic>> topics;
  final Set<String> picked;
  final ValueChanged<String> onToggle;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(64, 0, 16, 14),
      child: FutureBuilder<List<PrepTopic>>(
        future: topics,
        builder: (context, snap) {
          if (snap.hasError) return const Text('Topics could not load. Check Wi-Fi.', style: TextStyle(color: Palette.ink2));
          final list = snap.data;
          if (list == null) return const Align(alignment: Alignment.centerLeft, child: SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2)));
          if (list.isEmpty) return const Text('This chapter has no separate topics.', style: TextStyle(color: Palette.ink2));
          return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(picked.isEmpty ? 'All topics are included. Tap some to practise only those.' : 'Only the navy topics are included.',
                style: const TextStyle(color: Palette.ink2, fontSize: 12.5)),
            const SizedBox(height: 8),
            Wrap(spacing: 8, runSpacing: 8, children: [
              for (final t in list) _TopicChip(label: t.name, on: picked.contains(t.id), onTap: () => onToggle(t.id)),
            ]),
          ]);
        },
      ),
    );
  }
}

class _TopicChip extends StatelessWidget {
  const _TopicChip({required this.label, required this.on, required this.onTap});
  final String label;
  final bool on;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Material(
        color: on ? Palette.board : Palette.surface,
        shape: StadiumBorder(side: BorderSide(color: on ? Palette.board : const Color(0xFFCFD4DD))),
        child: InkWell(
          customBorder: const StadiumBorder(),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
            child: Text(label, style: TextStyle(fontSize: 13.5, color: on ? Colors.white : Palette.ink)),
          ),
        ),
      );
}

/// "Your practice": chosen chapters, difficulty, number of questions and Start.
class _Summary extends StatelessWidget {
  const _Summary({
    required this.exam,
    required this.levelLabel,
    required this.chosen,
    required this.difficulty,
    required this.count,
    required this.onDifficulty,
    required this.onCount,
    required this.onClear,
    required this.onStart,
  });
  final PrepExam exam;
  final String levelLabel;
  final List<(String, int)> chosen;
  final String difficulty;
  final int count;
  final ValueChanged<String> onDifficulty;
  final ValueChanged<int> onCount;
  final VoidCallback onClear;
  final VoidCallback? onStart;

  @override
  Widget build(BuildContext context) {
    const label = TextStyle(color: Palette.ink2, fontSize: 12, fontWeight: FontWeight.w700, letterSpacing: 0.8);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            const Expanded(child: Text('Your practice', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 17))),
            if (chosen.isNotEmpty) TextButton(onPressed: onClear, child: const Text('Clear')),
          ]),
          const SizedBox(height: 10),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: const Color(0xFFF4F6FA), borderRadius: BorderRadius.circular(12)),
            child: chosen.isEmpty
                ? const Text('Tick one or more chapters to start.', style: TextStyle(color: Palette.ink2, fontSize: 13.5))
                : Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    for (final (name, n) in chosen.take(5))
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 3),
                        child: Row(children: [
                          Expanded(child: Text(name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13.5))),
                          Text(n > 0 ? '$n topic${n == 1 ? '' : 's'}' : 'All topics', style: const TextStyle(color: Palette.goldInk, fontSize: 12)),
                        ]),
                      ),
                    if (chosen.length > 5)
                      Text('and ${chosen.length - 5} more', style: const TextStyle(color: Palette.ink2, fontSize: 12.5)),
                  ]),
          ),
          const SizedBox(height: 14),
          _Fact('Exam', '${exam.code} · $levelLabel'),
          _Fact('Marking', exam.marking.label),
          const SizedBox(height: 14),
          const Text('DIFFICULTY', style: label),
          const SizedBox(height: 8),
          Container(
            padding: const EdgeInsets.all(3),
            decoration: BoxDecoration(color: Palette.sunk, border: Border.all(color: Palette.line), borderRadius: BorderRadius.circular(10)),
            child: Row(children: [
              for (final (v, t) in const [('any', 'Any'), ('easy', 'Easy'), ('medium', 'Medium'), ('hard', 'Hard')])
                Expanded(
                  child: Material(
                    color: difficulty == v ? Palette.surface : Colors.transparent,
                    elevation: difficulty == v ? 1 : 0,
                    borderRadius: BorderRadius.circular(8),
                    child: InkWell(
                      borderRadius: BorderRadius.circular(8),
                      onTap: () => onDifficulty(v),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(vertical: 8),
                        child: Text(t,
                            textAlign: TextAlign.center,
                            maxLines: 1,
                            style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: difficulty == v ? Palette.board : Palette.ink2)),
                      ),
                    ),
                  ),
                ),
            ]),
          ),
          const SizedBox(height: 14),
          const Text('QUESTIONS', style: label),
          const SizedBox(height: 8),
          Row(children: [
            for (final (i, n) in const [10, 20, 30, 45, 60].indexed) ...[
              if (i > 0) const SizedBox(width: 6),
              Expanded(
                child: Material(
                  color: count == n ? Palette.board : Palette.surface,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(9), side: BorderSide(color: count == n ? Palette.board : Palette.line)),
                  child: InkWell(
                    borderRadius: BorderRadius.circular(9),
                    onTap: () => onCount(n),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 9),
                      child: Text('$n', textAlign: TextAlign.center, style: TextStyle(fontWeight: FontWeight.w600, color: count == n ? Colors.white : Palette.ink)),
                    ),
                  ),
                ),
              ),
            ],
          ]),
          const SizedBox(height: 18),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Palette.gold, foregroundColor: Palette.board, disabledBackgroundColor: const Color(0xFFE9E3D0), minimumSize: const Size(0, 52)),
            onPressed: onStart,
            child: const Row(mainAxisSize: MainAxisSize.min, children: [
              Text('Start practice', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
              SizedBox(width: 8),
              Icon(Icons.arrow_forward_rounded, size: 20),
            ]),
          ),
          const SizedBox(height: 10),
          const Text('Answers and solutions show after you submit.', textAlign: TextAlign.center, style: TextStyle(color: Palette.ink2, fontSize: 12.5)),
          const SizedBox(height: 4),
          TextButton(onPressed: () => AppShell.go(context, ShellTab.mock), child: const Text('Want a full timed paper? Try a mock test', textAlign: TextAlign.center)),
        ]),
      ),
    );
  }
}

class _Fact extends StatelessWidget {
  const _Fact(this.label, this.value);
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(children: [
          Text(label, style: const TextStyle(color: Palette.ink2, fontSize: 13.5)),
          const SizedBox(width: 12),
          Expanded(child: Text(value, textAlign: TextAlign.right, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13.5))),
        ]),
      );
}
