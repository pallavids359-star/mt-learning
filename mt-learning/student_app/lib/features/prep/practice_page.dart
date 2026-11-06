import 'package:flutter/material.dart';

import '../../core/app_scope.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import '../../data/api_client.dart';
import '../../data/prep_models.dart';
import '../shell/app_shell.dart';
import 'attempt_screen.dart';
import 'exam_choice.dart';

/// Practice: choose a subject, tick chapters, then set topics, difficulty and size.
class PracticePage extends StatefulWidget {
  const PracticePage({super.key});

  @override
  State<PracticePage> createState() => _PracticePageState();
}

class _PracticePageState extends State<PracticePage> {
  Future<List<SyllabusSubject>>? _syllabus;
  String? _examId;
  int _subject = 0;
  final Set<String> _picked = {};

  void _load(String examId) {
    _examId = examId;
    _syllabus = AppScope.read(context).prepApi.syllabus(examId);
    _picked.clear();
    _subject = 0;
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final exam = app.exam;
    if (exam == null) return const PageBody(children: [ExamChoice()]);
    if (_examId != exam.id) _load(exam.id);

    return Stack(children: [
      PageBody(children: [
        Row(children: [
          Expanded(child: Text('${exam.code} practice', style: Theme.of(context).textTheme.headlineSmall)),
          TextButton.icon(onPressed: () => changeExam(context), icon: const Icon(Icons.swap_horiz), label: const Text('Change exam')),
        ]),
        const Text('Tick one or more chapters, then start. Answers and explanations appear after you submit.', style: TextStyle(color: Palette.ink2)),
        const SizedBox(height: 14),
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
            final byClass = <String, List<SyllabusChapter>>{};
            for (final c in s.chapters) {
              byClass.putIfAbsent(c.classLevel, () => []).add(c);
            }
            return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(children: [
                  for (final (i, x) in subjects.indexed) ...[
                    if (i > 0) const SizedBox(width: 8),
                    ChoiceChip(
                      avatar: CircleAvatar(backgroundColor: Palette.subject(x.name.substring(0, x.name.length.clamp(0, 3)).toUpperCase()), radius: 5),
                      label: Text('${x.name} · ${x.questionCount}'),
                      selected: i == _subject,
                      onSelected: (_) => setState(() => _subject = i),
                    ),
                  ],
                ]),
              ),
              const SizedBox(height: 14),
              for (final e in byClass.entries) ...[
                Padding(
                  padding: const EdgeInsets.only(top: 6, bottom: 8),
                  child: Row(children: [
                    Text('Class ${e.key}', style: Theme.of(context).textTheme.titleMedium),
                    const Spacer(),
                    TextButton(
                      onPressed: () => setState(() {
                        final ids = e.value.where((c) => c.questionCount > 0).map((c) => c.id);
                        if (ids.every(_picked.contains)) {
                          _picked.removeAll(ids);
                        } else {
                          _picked.addAll(ids);
                        }
                      }),
                      child: const Text('Select all'),
                    ),
                  ]),
                ),
                Card(
                  child: Column(children: [
                    for (final (i, c) in e.value.indexed) ...[
                      if (i > 0) const Divider(),
                      _ChapterRow(chapter: c, picked: _picked.contains(c.id), onTap: c.questionCount == 0 ? null : () => setState(() => _picked.contains(c.id) ? _picked.remove(c.id) : _picked.add(c.id))),
                    ],
                  ]),
                ),
                const SizedBox(height: 8),
              ],
              const SizedBox(height: 80),
            ]);
          },
        ),
      ]),
      if (_picked.isNotEmpty)
        Positioned(
          left: 16,
          right: 16,
          bottom: 16,
          child: SafeArea(
            child: Material(
              elevation: 8,
              borderRadius: BorderRadius.circular(18),
              color: Palette.board,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(18, 10, 10, 10),
                child: Row(children: [
                  Expanded(child: Text('${_picked.length} chapter${_picked.length == 1 ? '' : 's'} selected', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600))),
                  TextButton(onPressed: () => setState(_picked.clear), child: const Text('Clear', style: TextStyle(color: Colors.white70))),
                  const SizedBox(width: 4),
                  FilledButton.icon(
                    style: FilledButton.styleFrom(backgroundColor: Colors.white, foregroundColor: Palette.board),
                    onPressed: () => _setup(context, exam),
                    icon: const Icon(Icons.play_arrow_rounded),
                    label: const Text('Set up practice'),
                  ),
                ]),
              ),
            ),
          ),
        ),
    ]);
  }

  Future<void> _setup(BuildContext context, PrepExam exam) async {
    final chapters = _picked.toList();
    final settings = await showModalBottomSheet<_Settings>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (_) => _SetupSheet(chapterIds: chapters),
    );
    if (settings == null || !context.mounted) return;
    final api = AppScope.read(context).prepApi;
    await runAttempt(context, () => api.practice(examId: exam.id, chapterIds: chapters, topicIds: settings.topicIds, difficulty: settings.difficulty, count: settings.count));
    if (mounted) setState(() => _load(exam.id)); // accuracy changed
  }
}

class _ChapterRow extends StatelessWidget {
  const _ChapterRow({required this.chapter, required this.picked, required this.onTap});
  final SyllabusChapter chapter;
  final bool picked;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final c = chapter;
    final acc = c.accuracy;
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        child: Row(children: [
          Checkbox(value: picked, onChanged: onTap == null ? null : (_) => onTap!()),
          const SizedBox(width: 4),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(c.name, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
              const SizedBox(height: 2),
              Text(c.questionCount == 0 ? 'No questions yet' : '${c.questionCount} questions${c.attempted > 0 ? ' · ${c.attempted} answered' : ''}',
                  style: const TextStyle(color: Palette.ink2, fontSize: 13)),
            ]),
          ),
          if (acc != null) Pill('$acc%', tone: acc >= 80 ? PillTone.ok : (acc >= 50 ? PillTone.warn : PillTone.bad)),
        ]),
      ),
    );
  }
}

class _Settings {
  const _Settings(this.topicIds, this.difficulty, this.count);
  final List<String> topicIds;
  final String difficulty;
  final int count;
}

class _SetupSheet extends StatefulWidget {
  const _SetupSheet({required this.chapterIds});
  final List<String> chapterIds;

  @override
  State<_SetupSheet> createState() => _SetupSheetState();
}

class _SetupSheetState extends State<_SetupSheet> {
  String _difficulty = 'any';
  int _count = 20;
  final Set<String> _topics = {};
  Future<List<PrepTopic>>? _topicList;

  @override
  void initState() {
    super.initState();
    // Topics only make sense when one chapter is chosen.
    if (widget.chapterIds.length == 1) _topicList = AppScope.read(context).prepApi.topics(widget.chapterIds.first);
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(22, 0, 22, 22),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('Set up practice', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 16),
          if (_topicList != null)
            FutureBuilder<List<PrepTopic>>(
              future: _topicList,
              builder: (context, snap) {
                final topics = snap.data ?? const [];
                if (topics.length < 2) return const SizedBox.shrink();
                return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  const Text('Topics', style: TextStyle(fontWeight: FontWeight.w600)),
                  const Text('Leave all off to practise the whole chapter.', style: TextStyle(color: Palette.ink2, fontSize: 13)),
                  const SizedBox(height: 8),
                  Wrap(spacing: 8, runSpacing: 8, children: [
                    for (final t in topics)
                      FilterChip(
                        label: Text('${t.name} · ${t.questionCount}'),
                        selected: _topics.contains(t.id),
                        onSelected: (on) => setState(() => on ? _topics.add(t.id) : _topics.remove(t.id)),
                      ),
                  ]),
                  const SizedBox(height: 18),
                ]);
              },
            ),
          const Text('Difficulty', style: TextStyle(fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          SegmentedButton<String>(
            segments: const [
              ButtonSegment(value: 'any', label: Text('Any')),
              ButtonSegment(value: 'easy', label: Text('Easy')),
              ButtonSegment(value: 'medium', label: Text('Medium')),
              ButtonSegment(value: 'hard', label: Text('Hard')),
            ],
            selected: {_difficulty},
            onSelectionChanged: (s) => setState(() => _difficulty = s.first),
          ),
          const SizedBox(height: 18),
          const Text('Number of questions', style: TextStyle(fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          Wrap(spacing: 8, children: [
            for (final n in const [10, 20, 30, 45, 60]) ChoiceChip(label: Text('$n'), selected: _count == n, onSelected: (_) => setState(() => _count = n)),
          ]),
          const SizedBox(height: 22),
          FilledButton.icon(
            onPressed: () => Navigator.pop(context, _Settings(_topics.toList(), _difficulty, _count)),
            icon: const Icon(Icons.play_arrow_rounded),
            label: const Text('Start practice'),
          ),
          const SizedBox(height: 6),
          TextButton(onPressed: () => AppShell.go(context, ShellTab.mock), child: const Text('Want a full timed paper? Try a mock test')),
        ]),
      ),
    );
  }
}
