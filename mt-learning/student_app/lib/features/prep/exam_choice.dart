import 'package:flutter/material.dart';

import '../../core/app_scope.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import '../../data/prep_models.dart';

const _examBlurb = {
  'NEET': 'Medical entrance · Physics, Chemistry, Biology',
  'JEE': 'Engineering entrance · Physics, Chemistry, Maths',
  'KCET': 'Karnataka CET · PCM or PCB',
};

/// Asks which exam the student prepares for. Shown until they choose; can be changed later.
class ExamChoice extends StatefulWidget {
  const ExamChoice({super.key, this.compact = false});
  final bool compact;

  @override
  State<ExamChoice> createState() => _ExamChoiceState();
}

class _ExamChoiceState extends State<ExamChoice> {
  String? _busy;

  Future<void> _pick(PrepExam e) async {
    setState(() => _busy = e.id);
    try {
      await AppScope.read(context).chooseExam(e.id);
      if (mounted && widget.compact) Navigator.of(context).maybePop();
    } catch (err) {
      if (mounted) showSnack(context, friendlyError(err));
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final exams = app.prep?.exams ?? const [];
    if (exams.isEmpty) {
      return EmptyState(
        icon: Icons.cloud_off,
        title: 'Exams not loaded yet',
        message: 'Connect to Wi-Fi so the exam list can download.',
        action: FilledButton(onPressed: app.sync, child: const Text('Try again')),
      );
    }
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      if (!widget.compact) ...[
        Text('Which exam are you preparing for?', style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: 4),
        const Text('Practice, mock tests and analytics follow this exam. You can change it any time.', style: TextStyle(color: Palette.ink2)),
        const SizedBox(height: 16),
      ],
      LayoutBuilder(builder: (context, c) {
        final cols = c.maxWidth >= 720 ? 3 : 1;
        final w = (c.maxWidth - (cols - 1) * 12) / cols;
        return Wrap(spacing: 12, runSpacing: 12, children: [
          for (final e in exams)
            SizedBox(
              width: w,
              child: Material(
                color: Palette.surface,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14),
                  side: BorderSide(color: app.exam?.id == e.id ? Palette.board : Palette.line, width: app.exam?.id == e.id ? 2 : 1),
                ),
                clipBehavior: Clip.antiAlias,
                child: Ink(
                  child: InkWell(
                    onTap: _busy == null ? () => _pick(e) : null,
                    child: Padding(
                      padding: const EdgeInsets.all(20),
                      child: Row(children: [
                        Expanded(
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text(e.code, style: const TextStyle(color: Palette.ink, fontSize: 24, fontWeight: FontWeight.w600)),
                            Text(_examBlurb[e.code] ?? e.name, style: const TextStyle(color: Palette.ink2)),
                            const SizedBox(height: 6),
                            Text('${e.marking.label} · ${e.durationMinutes} min paper', style: const TextStyle(color: Palette.ink3, fontSize: 13.5)),
                          ]),
                        ),
                        if (_busy == e.id)
                          const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2.5))
                        else if (app.exam?.id == e.id)
                          const Icon(Icons.check_circle, color: Palette.board)
                        else
                          const Icon(Icons.arrow_forward, color: Palette.ink3),
                      ]),
                    ),
                  ),
                ),
              ),
            ),
        ]);
      }),
    ]);
  }
}

/// Bottom sheet to switch exam.
Future<void> changeExam(BuildContext context) => showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (_) => const SafeArea(child: SingleChildScrollView(padding: EdgeInsets.fromLTRB(20, 0, 20, 24), child: ExamChoice(compact: true))),
    );
