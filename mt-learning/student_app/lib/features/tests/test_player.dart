import 'dart:async';

import 'package:battery_plus/battery_plus.dart';
import 'package:flutter/material.dart';

import '../../core/app_scope.dart';
import '../../core/format.dart';
import '../../core/math_text.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import '../../data/api_client.dart';
import '../../data/models.dart';
import '../../data/test_store.dart';

/// Full-screen test: one question at a time, a question palette, flags, a countdown,
/// and an autosave after every change so nothing is lost if the tablet switches off.
class TestPlayer extends StatefulWidget {
  const TestPlayer({super.key, required this.test});
  final TestInfo test;

  @override
  State<TestPlayer> createState() => _TestPlayerState();
}

class _TestPlayerState extends State<TestPlayer> with WidgetsBindingObserver {
  LocalAttempt? _a;
  Paper? _paper;
  String? _error;
  int _index = 0;
  Timer? _tick;
  bool _submitting = false;
  Timer? _reportSoon;
  bool _reporting = false;
  final _battery = Battery();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) => _begin());
  }

  Future<void> _begin() async {
    final app = AppScope.read(context);
    try {
      final a = await app.tests.begin(widget.test, deviceSerial: app.tabletSerial);
      if (!mounted) return;
      final paper = a.paper;
      setState(() {
        _a = a;
        _paper = paper;
        _index = paper.questions.isEmpty ? 0 : a.currentIndex.clamp(0, paper.questions.length - 1);
        if (paper.questions.isNotEmpty) a.visited.add(paper.questions[_index].id);
      });
      _tick = Timer.periodic(const Duration(seconds: 1), (_) => _onTick());
      if (a.remainingSec <= 0) {
        unawaited(_submit(auto: true));
      } else {
        unawaited(_report());
      }
    } on OfflineException {
      if (mounted) setState(() => _error = 'You are offline and this test was not downloaded. Connect to Wi-Fi to start it.');
    } catch (e) {
      if (mounted) setState(() => _error = friendlyError(e));
    }
  }

  void _onTick() {
    final a = _a;
    if (a == null || _submitting) return;
    setState(() => a.elapsedSec++);
    if (a.elapsedSec % 10 == 0) _save();
    // Staff see each tablet live in the portal's monitor.
    if (a.elapsedSec % 15 == 0) unawaited(_report());
    if (a.remainingSec <= 0) _submit(auto: true);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    if (s == AppLifecycleState.paused || s == AppLifecycleState.inactive) _save();
  }

  void _save() {
    final a = _a;
    if (a != null) unawaited(AppScope.read(context).tests.save(a));
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _tick?.cancel();
    _reportSoon?.cancel();
    super.dispose();
  }

  void _goTo(int i) {
    final a = _a!;
    final qs = _paper!.questions;
    setState(() {
      _index = i.clamp(0, qs.length - 1);
      a.currentIndex = _index;
      a.visited.add(qs[_index].id);
    });
    _save();
    _reportLater();
  }

  void _choose(PaperQuestion q, int option) {
    setState(() => _a!.answers[q.id] = _a!.answers[q.id] == option ? null : option);
    _save();
    _reportLater();
  }

  /// Reports a moment after the student stops tapping, so a burst of answers is one request.
  void _reportLater() {
    _reportSoon?.cancel();
    _reportSoon = Timer(const Duration(seconds: 3), () => unawaited(_report()));
  }

  Future<void> _report() async {
    final a = _a;
    if (a == null || _submitting || _reporting || !mounted) return;
    _reporting = true;
    int? level;
    bool? charging;
    try {
      level = await _battery.batteryLevel;
      final state = await _battery.batteryState;
      charging = state == BatteryState.charging || state == BatteryState.full;
    } catch (_) {
      // Battery not readable on this device: report without it.
    }
    if (!mounted) return;
    final reply = await AppScope.read(context).tests.progress(a, battery: level, charging: charging);
    _reporting = false;
    if (!mounted || reply == null || _submitting) return;
    switch (reply.status) {
      case 'ok':
        setState(() {}); // time left may have changed (more time from staff)
        _save();
      case 'submitted':
        _tick?.cancel();
        setState(() => _submitting = true);
        await AppScope.read(context).afterSubmit();
        if (!mounted) return;
        await Navigator.of(context).pushReplacement(MaterialPageRoute<void>(
          builder: (_) => TestDoneScreen(
            test: widget.test,
            outcome: reply.outcome,
            auto: false,
            byStaff: reply.byStaff,
            answered: a.answeredCount,
            total: _paper!.questions.length,
          ),
        ));
      case 'reset':
        _tick?.cancel();
        setState(() => _submitting = true);
        await showDialog<void>(
          context: context,
          barrierDismissible: false,
          builder: (ctx) => AlertDialog(
            title: const Text('Your teacher restarted this test'),
            content: const Text('Open it again from the Live tests page to start from question 1 with the full time.'),
            actions: [FilledButton(onPressed: () => Navigator.pop(ctx), child: const Text('OK'))],
          ),
        );
        if (!mounted) return;
        unawaited(AppScope.read(context).sync());
        Navigator.of(context).pop();
    }
  }

  void _toggleFlag(PaperQuestion q) {
    setState(() => _a!.flagged.contains(q.id) ? _a!.flagged.remove(q.id) : _a!.flagged.add(q.id));
    _save();
  }

  Future<void> _confirmSubmit() async {
    final a = _a!;
    final total = _paper!.questions.length;
    final left = total - a.answeredCount;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Submit test?'),
        content: Text([
          'You answered ${a.answeredCount} of $total questions.',
          if (left > 0) '$left ${left == 1 ? 'is' : 'are'} still unanswered.',
          if (a.flagged.isNotEmpty) '${a.flagged.length} marked for review.',
          'You cannot change answers after submitting.',
        ].join('\n')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Keep working')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Submit')),
        ],
      ),
    );
    if (ok == true) await _submit();
  }

  Future<void> _submit({bool auto = false}) async {
    if (_submitting) return;
    setState(() => _submitting = true);
    _tick?.cancel();
    final app = AppScope.read(context);
    final a = _a!;
    try {
      final outcome = await app.tests.submit(a, deviceSerial: app.tabletSerial);
      await app.afterSubmit();
      if (!mounted) return;
      await Navigator.of(context).pushReplacement(MaterialPageRoute<void>(
        builder: (_) => TestDoneScreen(test: widget.test, outcome: outcome, auto: auto, answered: a.answeredCount, total: _paper!.questions.length),
      ));
    } catch (e) {
      if (!mounted) return;
      setState(() => _submitting = false);
      showSnack(context, '${friendlyError(e)} Your answers are still saved on this tablet.');
    }
  }

  Future<bool> _confirmLeave() async {
    _save();
    final r = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Leave the test?'),
        content: Text(_a?.mode == 'ONLINE'
            ? 'Your answers are saved. The test timer keeps running on the college server, so come back soon.'
            : 'Your answers are saved. You can continue later from the Tests page.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Stay')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Leave')),
        ],
      ),
    );
    return r == true;
  }

  @override
  Widget build(BuildContext context) {
    if (_error != null) {
      return Scaffold(
        appBar: AppBar(title: Text(widget.test.title)),
        body: Padding(padding: const EdgeInsets.all(24), child: EmptyState(icon: Icons.cloud_off, title: 'Cannot start this test', message: _error)),
      );
    }
    final a = _a;
    final paper = _paper;
    if (a == null || paper == null) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    if (paper.questions.isEmpty) {
      return Scaffold(appBar: AppBar(title: Text(paper.title)), body: const Center(child: Text('This test has no questions.')));
    }
    final q = paper.questions[_index];
    final wide = MediaQuery.sizeOf(context).width >= 900;
    final low = a.remainingSec <= 60;

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop || _submitting) return;
        if (await _confirmLeave() && context.mounted) Navigator.of(context).pop();
      },
      child: Scaffold(
        appBar: AppBar(
          title: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(paper.title, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
            Text('${paper.subjectName}${a.mode == 'OFFLINE' ? ' · offline' : ''}', style: const TextStyle(fontSize: 12.5, color: Palette.ink2)),
          ]),
          actions: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              decoration: BoxDecoration(color: low ? Palette.badSoft : Palette.sunk, borderRadius: BorderRadius.circular(12)),
              child: Row(children: [
                Icon(Icons.timer_outlined, size: 18, color: low ? Palette.bad : Palette.ink),
                const SizedBox(width: 6),
                Semantics(
                  label: 'Time left',
                  child: Text(formatCountdown(a.remainingSec),
                      style: TextStyle(fontWeight: FontWeight.w600, fontFeatures: const [FontFeature.tabularFigures()], color: low ? Palette.bad : Palette.ink)),
                ),
              ]),
            ),
            const SizedBox(width: 10),
            Padding(
              padding: const EdgeInsets.only(right: 12),
              child: FilledButton(onPressed: _submitting ? null : _confirmSubmit, child: const Text('Submit')),
            ),
          ],
        ),
        body: _submitting
            ? const Center(child: Column(mainAxisSize: MainAxisSize.min, children: [CircularProgressIndicator(), SizedBox(height: 12), Text('Submitting…')]))
            : Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Expanded(child: _question(paper, q, a)),
                if (wide)
                  Container(
                    width: 300,
                    decoration: const BoxDecoration(color: Palette.surface, border: Border(left: BorderSide(color: Palette.line))),
                    child: SingleChildScrollView(padding: const EdgeInsets.all(18), child: _palette(paper, a)),
                  ),
              ]),
      ),
    );
  }

  Widget _question(Paper paper, PaperQuestion q, LocalAttempt a) {
    final selected = a.answers[q.id];
    final wide = MediaQuery.sizeOf(context).width >= 900;
    return Column(children: [
      LinearProgressIndicator(value: a.answeredCount / paper.questions.length, minHeight: 4, backgroundColor: Palette.sunk),
      Expanded(
        child: ListView(padding: const EdgeInsets.all(24), children: [
          Row(children: [
            Text('Question ${_index + 1} of ${paper.questions.length}', style: const TextStyle(color: Palette.ink2, fontWeight: FontWeight.w600)),
            const SizedBox(width: 10),
            Pill('${q.marks % 1 == 0 ? q.marks.toInt() : q.marks} mark${q.marks == 1 ? '' : 's'}'),
            const Spacer(),
            TextButton.icon(
              onPressed: () => _toggleFlag(q),
              icon: Icon(a.flagged.contains(q.id) ? Icons.flag : Icons.outlined_flag, color: Palette.marigold),
              label: Text(a.flagged.contains(q.id) ? 'Marked for review' : 'Mark for review'),
            ),
          ]),
          const SizedBox(height: 12),
          MathText(q.text, style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w600, height: 1.35)),
          const SizedBox(height: 20),
          for (var i = 0; i < q.options.length; i++)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: _Option(letter: String.fromCharCode(65 + i), text: q.options[i], selected: selected == i, onTap: () => _choose(q, i)),
            ),
          if (selected != null)
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton(onPressed: () => _choose(q, selected), child: const Text('Clear answer')),
            ),
          if (!wide) ...[const SizedBox(height: 18), _palette(paper, a)],
        ]),
      ),
      Container(
        padding: const EdgeInsets.fromLTRB(20, 10, 20, 14),
        decoration: const BoxDecoration(color: Palette.surface, border: Border(top: BorderSide(color: Palette.line))),
        child: SafeArea(
          top: false,
          child: Row(children: [
            OutlinedButton.icon(
              onPressed: _index == 0 ? null : () => _goTo(_index - 1),
              icon: const Icon(Icons.chevron_left),
              label: const Text('Previous'),
            ),
            const Spacer(),
            if (_index < paper.questions.length - 1)
              FilledButton.icon(
                onPressed: () => _goTo(_index + 1),
                icon: const Icon(Icons.chevron_right),
                label: const Text('Next'),
              )
            else
              FilledButton(onPressed: _confirmSubmit, child: const Text('Finish')),
          ]),
        ),
      ),
    ]);
  }

  Widget _palette(Paper paper, LocalAttempt a) {
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text('Questions', style: Theme.of(context).textTheme.titleMedium),
      const SizedBox(height: 4),
      Text('${a.answeredCount} answered · ${a.flagged.length} marked', style: const TextStyle(color: Palette.ink2, fontSize: 13)),
      const SizedBox(height: 12),
      Wrap(spacing: 8, runSpacing: 8, children: [
        for (var i = 0; i < paper.questions.length; i++)
          _PaletteCell(
            n: i + 1,
            current: i == _index,
            answered: a.answers[paper.questions[i].id] != null,
            flagged: a.flagged.contains(paper.questions[i].id),
            onTap: () => _goTo(i),
          ),
      ]),
      const SizedBox(height: 16),
      const Wrap(spacing: 14, runSpacing: 6, children: [
        _Legend(color: Palette.board, label: 'Answered'),
        _Legend(color: Palette.marigold, label: 'Marked'),
        _Legend(color: Palette.sunk, label: 'Not answered'),
      ]),
      if (paper.negativeMarks > 0) ...[
        const SizedBox(height: 16),
        Text('Wrong answers lose ${paper.negativeMarks % 1 == 0 ? paper.negativeMarks.toInt() : paper.negativeMarks} mark. Leave a question blank if unsure.',
            style: const TextStyle(color: Palette.ink2, fontSize: 13)),
      ],
    ]);
  }
}

class _Option extends StatelessWidget {
  const _Option({required this.letter, required this.text, required this.selected, required this.onTap});
  final String letter;
  final String text;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      selected: selected,
      button: true,
      child: Material(
        color: selected ? Palette.boardSoft : Palette.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: BorderSide(color: selected ? Palette.board : Palette.line, width: selected ? 2 : 1),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
            child: Row(children: [
              Container(
                width: 32,
                height: 32,
                alignment: Alignment.center,
                decoration: BoxDecoration(color: selected ? Palette.board : Palette.sunk, borderRadius: BorderRadius.circular(12)),
                child: Text(letter, style: TextStyle(fontWeight: FontWeight.w600, color: selected ? Colors.white : Palette.ink2)),
              ),
              const SizedBox(width: 12),
              Expanded(child: MathText(text, style: const TextStyle(fontSize: 16, color: Palette.ink))),
            ]),
          ),
        ),
      ),
    );
  }
}

class _PaletteCell extends StatelessWidget {
  const _PaletteCell({required this.n, required this.current, required this.answered, required this.flagged, required this.onTap});
  final int n;
  final bool current;
  final bool answered;
  final bool flagged;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final bg = flagged ? Palette.marigold : (answered ? Palette.board : Palette.sunk);
    final fg = answered || flagged ? Colors.white : Palette.ink;
    return Semantics(
      label: 'Question $n${answered ? ', answered' : ''}${flagged ? ', marked' : ''}',
      button: true,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Container(
          width: 42,
          height: 42,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: bg,
            borderRadius: BorderRadius.circular(12),
            border: current ? Border.all(color: Palette.ink, width: 2) : null,
          ),
          child: Text('$n', style: TextStyle(color: fg, fontWeight: FontWeight.w700)),
        ),
      ),
    );
  }
}

class _Legend extends StatelessWidget {
  const _Legend({required this.color, required this.label});
  final Color color;
  final String label;

  @override
  Widget build(BuildContext context) => Row(mainAxisSize: MainAxisSize.min, children: [
        Container(width: 12, height: 12, decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(3))),
        const SizedBox(width: 6),
        Text(label, style: const TextStyle(fontSize: 12.5, color: Palette.ink2)),
      ]);
}

/// Shown after submitting: the score, "waiting for review", or "saved, will upload".
class TestDoneScreen extends StatelessWidget {
  const TestDoneScreen({super.key, required this.test, required this.outcome, required this.auto, required this.answered, required this.total, this.byStaff = false});
  final TestInfo test;
  final SubmitOutcome? outcome;
  final bool auto;
  final bool byStaff;
  final int answered;
  final int total;

  @override
  Widget build(BuildContext context) {
    final o = outcome;
    final t = Theme.of(context).textTheme;
    final (icon, color, title, message) = byStaff
        ? (Icons.assignment_turned_in_outlined, Palette.board, 'Submitted by your teacher', 'Your teacher submitted the answers saved so far. Ask them if you think this was a mistake.')
        : o == null
        ? (
            Icons.cloud_upload_outlined,
            Palette.warn,
            'Saved on this tablet',
            'You are offline. Your answers will upload by themselves when the tablet is back on Wi-Fi. Don\'t sign out until then.',
          )
        : o.reviewStatus == 'PENDING'
            ? (
                Icons.hourglass_top,
                Palette.warn,
                'Submitted for review',
                o.message ?? 'Your answers arrived after the test closed, so your teacher will check them before they count.',
              )
            : (Icons.check_circle, Palette.ok, 'Test submitted', 'Well done for finishing.');

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(28),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 480),
              child: Column(children: [
                Icon(icon, size: 56, color: color),
                const SizedBox(height: 12),
                if (auto) const Padding(padding: EdgeInsets.only(bottom: 6), child: Pill('Time is up', tone: PillTone.warn)),
                if (byStaff) const Padding(padding: EdgeInsets.only(bottom: 6), child: Pill('Submitted by teacher', tone: PillTone.board)),
                Text(title, style: t.headlineSmall, textAlign: TextAlign.center),
                const SizedBox(height: 6),
                Text(test.title, style: const TextStyle(color: Palette.ink2)),
                const SizedBox(height: 22),
                if (o != null && o.percent != null) ...[
                  Ring(percent: o.percent, label: 'score', color: _scoreColor(o.percent!), size: 150),
                  const SizedBox(height: 14),
                  Text(
                    '${_n(o.score)} out of ${_n(o.maxScore)} marks · ${o.correctCount ?? 0} correct',
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 6),
                  const Text('You can see the correct answers once the test closes for everyone.',
                      textAlign: TextAlign.center, style: TextStyle(color: Palette.ink2)),
                ] else
                  Text(message, textAlign: TextAlign.center, style: const TextStyle(color: Palette.ink2, height: 1.4)),
                const SizedBox(height: 10),
                Text('$answered of $total answered', style: const TextStyle(color: Palette.ink3)),
                const SizedBox(height: 24),
                FilledButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Back to tests')),
              ]),
            ),
          ),
        ),
      ),
    );
  }

  static Color _scoreColor(double p) => p >= 60 ? Palette.ok : (p >= 35 ? Palette.warn : Palette.bad);

  static String _n(double? v) => v == null ? '—' : (v % 1 == 0 ? v.toInt().toString() : v.toStringAsFixed(2));
}
