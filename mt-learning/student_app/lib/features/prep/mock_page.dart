import 'package:flutter/material.dart';

import '../../core/app_scope.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import '../../data/api_client.dart';
import '../../data/prep_models.dart';
import '../shell/app_shell.dart';
import 'attempt_screen.dart';
import 'exam_choice.dart';

/// Paper pattern shown before starting, matching the server's mock patterns.
const _patterns = {
  'NEET': ('Physics 45 · Chemistry 45 · Biology 90', '180 questions · 3 hours'),
  'JEE': ('Physics 25 · Chemistry 25 · Maths 25', '75 questions · 3 hours'),
  'KCET': ('60 questions in each of three subjects', '180 questions · 4 hours'),
};

String _n(double? v) => v == null ? '—' : (v % 1 == 0 ? v.toInt().toString() : v.toStringAsFixed(1));

/// Full-length timed papers in the real exam pattern.
class MockPage extends StatefulWidget {
  const MockPage({super.key});

  @override
  State<MockPage> createState() => _MockPageState();
}

class _MockPageState extends State<MockPage> {
  Future<List<MockRow>>? _list;
  String? _examId;
  String _stream = 'PCM';

  void _load(String examId) {
    _examId = examId;
    _list = AppScope.read(context).prepApi.mocks(examId);
  }

  Future<void> _start(PrepExam exam) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Start a ${exam.code} mock test?'),
        content: Text(
          'The timer starts now and keeps running even if you close the app. '
          'Stay in the test: leaving the app three times submits it for you.\n\n'
          'Marking: ${exam.marking.label}.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Not now')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Start')),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    final api = AppScope.read(context).prepApi;
    await runAttempt(context, () => api.mock(examId: exam.id, stream: exam.code == 'KCET' ? _stream : null));
    if (mounted) setState(() => _load(exam.id));
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final exam = app.exam;
    if (exam == null) return const PageBody(children: [ExamChoice()]);
    if (_examId != exam.id) _load(exam.id);
    final pattern = exam.code == 'KCET'
        ? switch (_stream) {
            'PCB' => ('Physics 60 \u00b7 Chemistry 60 \u00b7 Biology 60', '180 questions \u00b7 4 hours'),
            'PCMB' => ('Physics 60 \u00b7 Chemistry 60 \u00b7 Maths 60 \u00b7 Biology 60', '240 questions \u00b7 5 h 20 min'),
            _ => ('Physics 60 \u00b7 Chemistry 60 \u00b7 Maths 60', '180 questions \u00b7 4 hours'),
          }
        : _patterns[exam.code];

    return PageBody(maxWidth: 960, children: [
      Row(children: [
        Expanded(child: Text('${exam.code} mock tests', style: Theme.of(context).textTheme.headlineSmall)),
        TextButton.icon(onPressed: () => changeExam(context), icon: const Icon(Icons.swap_horiz), label: const Text('Change exam')),
      ]),
      const SizedBox(height: 14),
      Container(
        padding: const EdgeInsets.all(22),
        decoration: BoxDecoration(
          color: Palette.board,
          borderRadius: BorderRadius.circular(20),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('Full paper', style: TextStyle(color: Colors.white70, fontWeight: FontWeight.w500)),
          const SizedBox(height: 6),
          Text(pattern?.$2 ?? '${exam.durationMinutes} minutes', style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.w700)),
          if (pattern != null) Text(pattern.$1, style: TextStyle(color: Colors.white.withValues(alpha: 0.88))),
          Text('Marking ${exam.marking.label}', style: TextStyle(color: Colors.white.withValues(alpha: 0.75), fontSize: 13)),
          if (exam.code == 'KCET') ...[
            const SizedBox(height: 14),
            SegmentedButton<String>(
              style: SegmentedButton.styleFrom(
                backgroundColor: Colors.white.withValues(alpha: 0.1),
                foregroundColor: Colors.white,
                selectedBackgroundColor: Colors.white,
                selectedForegroundColor: Palette.board,
              ),
              segments: const [
                ButtonSegment(value: 'PCM', label: Text('PCM (Maths)')),
                ButtonSegment(value: 'PCB', label: Text('PCB (Biology)')),
                ButtonSegment(value: 'PCMB', label: Text('PCMB (all four)')),
              ],
              selected: {_stream},
              onSelectionChanged: (s) => setState(() => _stream = s.first),
            ),
          ],
          const SizedBox(height: 16),
          FilledButton.icon(
            style: FilledButton.styleFrom(backgroundColor: Colors.white, foregroundColor: Palette.board),
            onPressed: () => _start(exam),
            icon: const Icon(Icons.timer_outlined),
            label: const Text('Start a mock test'),
          ),
          const SizedBox(height: 6),
          Text('If you already have a mock test running, this continues it.', style: TextStyle(color: Colors.white.withValues(alpha: 0.7), fontSize: 12.5)),
        ]),
      ),
      const SizedBox(height: 22),
      const SectionTitle('Your mock tests'),
      const SizedBox(height: 8),
      FutureBuilder<List<MockRow>>(
        future: _list,
        builder: (context, snap) {
          if (snap.hasError) {
            return EmptyState(
              icon: Icons.cloud_off,
              title: 'Could not load your mock tests',
              message: snap.error is OfflineException ? 'Connect to Wi-Fi and try again.' : friendlyError(snap.error!),
              action: FilledButton(onPressed: () => setState(() => _load(exam.id)), child: const Text('Try again')),
            );
          }
          final rows = snap.data;
          if (rows == null) return const Padding(padding: EdgeInsets.all(30), child: Center(child: CircularProgressIndicator()));
          if (rows.isEmpty) {
            return const EmptyState(icon: Icons.timer_outlined, title: 'No mock tests yet', message: 'Your scores and reviews will appear here.');
          }
          return Card(
            child: Column(children: [
              for (final (i, m) in rows.indexed) ...[
                if (i > 0) const Divider(),
                ListTile(
                  onTap: () async {
                    await runAttempt(context, () => app.prepApi.attempt(m.attemptId));
                    if (mounted) setState(() => _load(exam.id));
                  },
                  leading: CircleAvatar(
                    backgroundColor: m.inProgress ? Palette.marigoldSoft : Palette.boardSoft,
                    child: Icon(m.inProgress ? Icons.play_arrow_rounded : Icons.assignment_turned_in_outlined, color: m.inProgress ? Palette.warn : Palette.board),
                  ),
                  title: Text(m.title, style: const TextStyle(fontWeight: FontWeight.w700)),
                  subtitle: Text([
                    '${m.questions} questions',
                    if (m.startedAt != null) formatDateTime(m.startedAt!),
                    if (m.inProgress && m.remainingSec != null) '${formatCountdown(m.remainingSec!)} left',
                  ].join(' · ')),
                  trailing: m.inProgress
                      ? const Pill('Continue', tone: PillTone.warn)
                      : Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
                          Text('${_n(m.score)}/${_n(m.maxScore)}', style: const TextStyle(fontWeight: FontWeight.w700)),
                          Text(m.percentage == null ? '' : '${_n(m.percentage)}%', style: const TextStyle(color: Palette.ink2, fontSize: 12)),
                        ]),
                ),
              ],
            ]),
          );
        },
      ),
      const SizedBox(height: 14),
      TextButton(onPressed: () => AppShell.go(context, ShellTab.analytics), child: const Text('See how your mock scores are trending')),
    ]);
  }
}
