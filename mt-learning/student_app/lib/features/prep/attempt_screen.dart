import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/app_scope.dart';
import '../../core/format.dart';
import '../../core/math_text.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import '../../data/api_client.dart';
import '../../data/prep_models.dart';
import 'result_screen.dart';

/// Opens an attempt (or its result if already finished) after loading it, with errors as a snack bar.
Future<void> runAttempt(BuildContext context, Future<Object> Function() load) async {
  final nav = Navigator.of(context);
  showDialog<void>(context: context, barrierDismissible: false, builder: (_) => const Center(child: CircularProgressIndicator()));
  try {
    final r = await load();
    nav.pop();
    final route = switch (r) {
      PrepAttempt a => MaterialPageRoute<void>(builder: (_) => AttemptScreen(attempt: a), fullscreenDialog: true),
      InProgress(:final attempt) => MaterialPageRoute<void>(builder: (_) => AttemptScreen(attempt: attempt), fullscreenDialog: true),
      Finished(:final review) => MaterialPageRoute<void>(builder: (_) => ResultScreen(review: review)),
      PrepReview rv => MaterialPageRoute<void>(builder: (_) => ResultScreen(review: rv)),
      _ => null,
    };
    if (route != null) await nav.push(route);
  } catch (e) {
    nav.pop();
    if (context.mounted) showSnack(context, e is OfflineException ? 'Practice needs Wi-Fi. Connect and try again.' : friendlyError(e));
  }
  if (context.mounted) unawaited(AppScope.read(context).refreshPrep(quiet: true));
}

/// Answering screen for practice, mock tests and revision, GenPrep style.
class AttemptScreen extends StatefulWidget {
  const AttemptScreen({super.key, required this.attempt});
  final PrepAttempt attempt;

  @override
  State<AttemptScreen> createState() => _AttemptScreenState();
}

class _AttemptScreenState extends State<AttemptScreen> with WidgetsBindingObserver {
  late final PrepAttempt a = widget.attempt;
  int _index = 0;
  final Set<int> _visited = {0};
  Timer? _tick;
  int _elapsed = 0;
  int? _remaining;
  bool _dirty = false;
  bool _saving = false;
  bool _saveFailed = false;
  bool _submitting = false;
  int _warnings = 0;
  bool _leftApp = false;
  final _numCtl = TextEditingController();

  static const _maxWarnings = 3;

  PrepQuestion get q => a.questions[_index];
  PrepAnswer get ans => a.answers[q.id]!;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _remaining = a.remainingSec;
    _syncNumField();
    _tick = Timer.periodic(const Duration(seconds: 1), (_) => _onTick());
    if (_remaining == 0) WidgetsBinding.instance.addPostFrameCallback((_) => _submit(auto: true));
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _tick?.cancel();
    _numCtl.dispose();
    super.dispose();
  }

  void _onTick() {
    if (_submitting || !mounted) return;
    setState(() {
      _elapsed++;
      ans.timeSec++;
      if (_remaining != null) _remaining = _remaining! - 1;
    });
    if (_elapsed % 20 == 0) _save();
    if (_remaining != null && _remaining! <= 0) _submit(auto: true);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    if (s == AppLifecycleState.paused || s == AppLifecycleState.hidden) {
      _save();
      // Mock tests follow exam rules: leaving the app counts as a warning.
      if (a.isMock && !_submitting) _leftApp = true;
    }
    if (s == AppLifecycleState.resumed && _leftApp) {
      _leftApp = false;
      _warn();
    }
  }

  Future<void> _warn() async {
    setState(() => _warnings++);
    if (_warnings >= _maxWarnings) {
      await _submit(auto: true, reason: 'You left the test $_maxWarnings times, so it was submitted.');
      return;
    }
    if (!mounted) return;
    await showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        icon: const Icon(Icons.warning_amber_rounded, color: Palette.warn, size: 36),
        title: Text('Warning $_warnings of $_maxWarnings'),
        content: Text('Mock tests follow exam rules: stay in the app until you submit. '
            'Leaving ${_maxWarnings - _warnings} more time${_maxWarnings - _warnings == 1 ? '' : 's'} submits the test.'),
        actions: [FilledButton(onPressed: () => Navigator.pop(ctx), child: const Text('Back to the test'))],
      ),
    );
  }

  Future<void> _save() async {
    if (!_dirty || _saving || _submitting) return;
    _saving = true;
    _dirty = false;
    try {
      await AppScope.read(context).prepApi.save(a.attemptId, a.answers.values);
      if (mounted) setState(() => _saveFailed = false);
    } on ApiException catch (e) {
      if (e.statusCode == 409 && mounted) {
        // The server closed it (time ran out): show the result.
        await _submit(auto: true);
      }
    } catch (_) {
      _dirty = true;
      if (mounted) setState(() => _saveFailed = true);
    } finally {
      _saving = false;
    }
  }

  void _change(void Function() f) {
    setState(f);
    _dirty = true;
  }

  void _go(int i) {
    if (i < 0 || i >= a.questions.length) return;
    setState(() {
      _index = i;
      _visited.add(i);
    });
    _syncNumField();
  }

  void _syncNumField() {
    final v = ans.numerical;
    _numCtl.text = v == null ? '' : (v % 1 == 0 ? v.toInt().toString() : v.toString());
  }

  void _choose(String id) => _change(() {
        if (q.isMulti) {
          ans.selected.contains(id) ? ans.selected.remove(id) : ans.selected.add(id);
          ans.selected.sort();
        } else {
          ans.selected = ans.selected.length == 1 && ans.selected.first == id ? [] : [id];
        }
      });

  Future<void> _confirmSubmit() async {
    final total = a.questions.length;
    final answered = a.answeredCount;
    final marked = a.answers.values.where((x) => x.marked).length;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Submit?'),
        content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          _SummaryRow(color: Palette.teal, label: 'Answered', value: answered),
          _SummaryRow(color: Palette.sunk, label: 'Not answered', value: total - answered),
          _SummaryRow(color: Palette.tiles[3].first, label: 'Marked for review', value: marked),
          const SizedBox(height: 10),
          const Text('You can’t change answers after submitting.', style: TextStyle(color: Palette.ink2)),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Keep going')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Submit')),
        ],
      ),
    );
    if (ok == true) await _submit();
  }

  Future<void> _submit({bool auto = false, String? reason}) async {
    if (_submitting) return;
    setState(() => _submitting = true);
    _tick?.cancel();
    final app = AppScope.read(context);
    final nav = Navigator.of(context);
    for (var tries = 0; tries < 3; tries++) {
      try {
        final review = await app.prepApi.submit(a.attemptId, a.answers.values);
        unawaited(app.refreshPrep(quiet: true));
        await nav.pushReplacement(MaterialPageRoute<void>(builder: (_) => ResultScreen(review: review, note: reason ?? (auto ? 'Time is up. Your answers were submitted.' : null))));
        return;
      } on OfflineException {
        if (tries < 2) await Future<void>.delayed(const Duration(seconds: 2));
      } catch (e) {
        if (!mounted) return;
        setState(() => _submitting = false);
        showSnack(context, friendlyError(e));
        return;
      }
    }
    if (!mounted) return;
    setState(() => _submitting = false);
    if (!auto) _tick = Timer.periodic(const Duration(seconds: 1), (_) => _onTick());
    showSnack(context, 'Could not reach the server. Your answers are kept; check the Wi-Fi and press Submit again.');
  }

  Future<bool> _confirmLeave() async {
    await _save();
    if (!mounted) return false;
    final r = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Leave for now?'),
        content: Text(a.isMock
            ? 'Your answers are saved, but the mock-test timer keeps running. Continue it soon from Mock tests.'
            : 'Your answers are saved. Continue any time from Home.'),
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
    final wide = MediaQuery.sizeOf(context).width >= 900;
    final low = _remaining != null && _remaining! <= 300;
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop || _submitting) return;
        if (await _confirmLeave() && context.mounted) Navigator.of(context).pop();
      },
      child: Scaffold(
        appBar: AppBar(
          title: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(a.title, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600), maxLines: 1, overflow: TextOverflow.ellipsis),
            Text('${a.examCode} · ${a.marking.label}', style: const TextStyle(fontSize: 12.5, color: Palette.ink2)),
          ]),
          actions: [
            if (_saveFailed) const Padding(padding: EdgeInsets.only(right: 8), child: Pill('Not saved', tone: PillTone.warn, icon: Icons.cloud_off)),
            if (a.isMock && _warnings > 0) Padding(padding: const EdgeInsets.only(right: 8), child: Pill('$_warnings/$_maxWarnings', tone: PillTone.bad, icon: Icons.warning_amber_rounded)),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
              decoration: BoxDecoration(color: low ? Palette.badSoft : Palette.sunk, borderRadius: BorderRadius.circular(10)),
              child: Row(children: [
                Icon(_remaining == null ? Icons.timer_outlined : Icons.hourglass_bottom, size: 18, color: low ? Palette.bad : Palette.ink),
                const SizedBox(width: 6),
                Text(formatCountdown(_remaining ?? _elapsed),
                    style: TextStyle(fontWeight: FontWeight.w700, fontFeatures: const [FontFeature.tabularFigures()], color: low ? Palette.bad : Palette.ink)),
              ]),
            ),
            const SizedBox(width: 8),
            if (!wide)
              IconButton(tooltip: 'All questions', icon: const Icon(Icons.grid_view_rounded), onPressed: () => _showPalette(context)),
            Padding(
              padding: const EdgeInsets.only(right: 12),
              child: FilledButton(onPressed: _submitting ? null : _confirmSubmit, child: const Text('Submit')),
            ),
          ],
        ),
        body: _submitting
            ? const Center(child: Column(mainAxisSize: MainAxisSize.min, children: [CircularProgressIndicator(), SizedBox(height: 14), Text('Submitting…')]))
            : Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Expanded(child: _question()),
                if (wide)
                  Container(
                    width: 320,
                    decoration: const BoxDecoration(color: Palette.surface, border: Border(left: BorderSide(color: Palette.line))),
                    child: SingleChildScrollView(padding: const EdgeInsets.all(18), child: _palette()),
                  ),
              ]),
      ),
    );
  }

  Widget _question() {
    final t = Theme.of(context).textTheme;
    return Column(children: [
      LinearProgressIndicator(value: a.answeredCount / a.questions.length, minHeight: 4, backgroundColor: Palette.sunk, color: Palette.teal),
      Expanded(
        child: ListView(padding: const EdgeInsets.fromLTRB(22, 20, 22, 24), children: [
          Wrap(spacing: 8, runSpacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
            Text('Question ${_index + 1} of ${a.questions.length}', style: const TextStyle(fontWeight: FontWeight.w600, color: Palette.ink2)),
            Pill(q.subjectName, tone: PillTone.board),
            if (q.isMulti) const Pill('More than one answer', tone: PillTone.warn),
            if (q.isNumerical) const Pill('Type a number', tone: PillTone.warn),
            Pill(q.difficulty[0].toUpperCase() + q.difficulty.substring(1)),
          ]),
          if (q.chapterName.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 6), child: Text(q.chapterName, style: const TextStyle(color: Palette.ink3, fontSize: 13))),
          const SizedBox(height: 14),
          MathText(q.text, images: q.images, style: t.titleLarge?.copyWith(fontWeight: FontWeight.w600, height: 1.4, color: Palette.ink)),
          const SizedBox(height: 18),
          if (q.isNumerical)
            TextField(
              controller: _numCtl,
              keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true),
              inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'^-?\d*\.?\d*'))],
              decoration: const InputDecoration(labelText: 'Your answer', hintText: 'e.g. 4 or 2.5'),
              onChanged: (v) => _change(() => ans.numerical = double.tryParse(v)),
            )
          else
            for (final o in q.options)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: _OptionTile(option: o, selected: ans.selected.contains(o.id), multi: q.isMulti, onTap: () => _choose(o.id)),
              ),
        ]),
      ),
      Container(
        padding: const EdgeInsets.fromLTRB(16, 10, 16, 12),
        decoration: const BoxDecoration(color: Palette.surface, border: Border(top: BorderSide(color: Palette.line))),
        child: SafeArea(
          top: false,
          child: Wrap(spacing: 8, runSpacing: 8, alignment: WrapAlignment.spaceBetween, crossAxisAlignment: WrapCrossAlignment.center, children: [
            OutlinedButton.icon(onPressed: _index == 0 ? null : () => _go(_index - 1), icon: const Icon(Icons.chevron_left), label: const Text('Previous')),
            Wrap(spacing: 8, children: [
              TextButton.icon(
                onPressed: () => _change(() => ans.marked = !ans.marked),
                icon: Icon(ans.marked ? Icons.bookmark_added : Icons.bookmark_add_outlined, color: Palette.tiles[3].first),
                label: Text(ans.marked ? 'Marked' : 'Mark for review'),
              ),
              if (ans.answered)
                TextButton(
                  onPressed: () {
                    _change(() {
                      ans.selected = [];
                      ans.numerical = null;
                    });
                    _numCtl.clear();
                  },
                  child: const Text('Clear'),
                ),
            ]),
            _index < a.questions.length - 1
                ? FilledButton.icon(onPressed: () => _go(_index + 1), icon: const Icon(Icons.chevron_right), label: const Text('Save & next'))
                : FilledButton(onPressed: _confirmSubmit, child: const Text('Finish')),
          ]),
        ),
      ),
    ]);
  }

  void _showPalette(BuildContext context) {
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (ctx) => SafeArea(child: SingleChildScrollView(padding: const EdgeInsets.fromLTRB(20, 0, 20, 20), child: _palette(onPick: () => Navigator.pop(ctx)))),
    );
  }

  Widget _palette({VoidCallback? onPick}) {
    final answered = a.answeredCount;
    final marked = a.answers.values.where((x) => x.marked).length;
    // Group the palette by subject, like the real exam.
    final groups = <String, List<int>>{};
    for (var i = 0; i < a.questions.length; i++) {
      groups.putIfAbsent(a.questions[i].subjectName, () => []).add(i);
    }
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text('Questions', style: Theme.of(context).textTheme.titleMedium),
      const SizedBox(height: 4),
      Text('$answered answered · $marked marked · ${a.questions.length - answered} left', style: const TextStyle(color: Palette.ink2, fontSize: 13)),
      const SizedBox(height: 12),
      for (final g in groups.entries) ...[
        if (groups.length > 1) Padding(padding: const EdgeInsets.only(top: 6, bottom: 6), child: Text(g.key, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13))),
        Wrap(spacing: 7, runSpacing: 7, children: [
          for (final i in g.value)
            _Cell(
              n: i + 1,
              current: i == _index,
              answered: a.answers[a.questions[i].id]!.answered,
              marked: a.answers[a.questions[i].id]!.marked,
              visited: _visited.contains(i),
              onTap: () {
                _go(i);
                onPick?.call();
              },
            ),
        ]),
      ],
      const SizedBox(height: 16),
      Wrap(spacing: 14, runSpacing: 6, children: [
        const _Legend(color: Palette.teal, label: 'Answered'),
        _Legend(color: Palette.tiles[3].first, label: 'Marked'),
        const _Legend(color: Palette.badSoft, label: 'Seen, not answered'),
        const _Legend(color: Palette.sunk, label: 'Not seen'),
      ]),
      if (a.isMock) ...[
        const SizedBox(height: 16),
        Text('Exam rules: stay in the app. Leaving it $_maxWarnings times submits the test.', style: const TextStyle(color: Palette.ink2, fontSize: 13)),
      ],
    ]);
  }
}

class _OptionTile extends StatelessWidget {
  const _OptionTile({required this.option, required this.selected, required this.multi, required this.onTap});
  final PrepOption option;
  final bool selected;
  final bool multi;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      selected: selected,
      button: true,
      label: 'Option ${option.id}',
      child: Material(
        color: selected ? Palette.tealSoft : Palette.surface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14), side: BorderSide(color: selected ? Palette.teal : Palette.line, width: selected ? 2 : 1)),
        child: InkWell(
          borderRadius: BorderRadius.circular(14),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Container(
                width: 34,
                height: 34,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: selected ? Palette.teal : Palette.sunk,
                  shape: multi ? BoxShape.rectangle : BoxShape.circle,
                  borderRadius: multi ? BorderRadius.circular(9) : null,
                ),
                child: selected && multi
                    ? const Icon(Icons.check, color: Colors.white, size: 20)
                    : Text(option.id, style: TextStyle(fontWeight: FontWeight.w700, color: selected ? Colors.white : Palette.ink2)),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: MathText(option.text, images: [if (option.image != null) option.image!], style: const TextStyle(fontSize: 16, color: Palette.ink, height: 1.35)),
                ),
              ),
            ]),
          ),
        ),
      ),
    );
  }
}

class _Cell extends StatelessWidget {
  const _Cell({required this.n, required this.current, required this.answered, required this.marked, required this.visited, required this.onTap});
  final int n;
  final bool current;
  final bool answered;
  final bool marked;
  final bool visited;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final Color bg = marked ? Palette.tiles[3].first : (answered ? Palette.teal : (visited ? Palette.badSoft : Palette.sunk));
    final Color fg = marked || answered ? Colors.white : (visited ? Palette.bad : Palette.ink);
    return Semantics(
      button: true,
      label: 'Question $n${answered ? ', answered' : ''}${marked ? ', marked' : ''}',
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(10),
        child: Container(
          width: 40,
          height: 40,
          alignment: Alignment.center,
          decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(10), border: current ? Border.all(color: Palette.ink, width: 2) : null),
          child: Text('$n', style: TextStyle(color: fg, fontWeight: FontWeight.w600, fontSize: 13.5)),
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

class _SummaryRow extends StatelessWidget {
  const _SummaryRow({required this.color, required this.label, required this.value});
  final Color color;
  final String label;
  final int value;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(children: [
          Container(width: 12, height: 12, decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(3), border: Border.all(color: Palette.line))),
          const SizedBox(width: 10),
          Expanded(child: Text(label)),
          Text('$value', style: const TextStyle(fontWeight: FontWeight.w600)),
        ]),
      );
}
