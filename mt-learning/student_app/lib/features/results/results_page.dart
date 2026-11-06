import 'package:flutter/material.dart';

import '../../core/app_scope.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import '../../data/models.dart';
import '../shell/app_shell.dart';

class ResultsPage extends StatelessWidget {
  const ResultsPage({super.key});

  @override
  Widget build(BuildContext context) {
    final r = AppScope.of(context).results;
    if (r == null || r.testsTaken == 0) {
      return PageBody(children: [
        const EmptyState(icon: Icons.insights_outlined, title: 'No results yet', message: 'Your scores appear here after your first test.'),
        if (r != null && r.awaitingReview > 0) ...[const SizedBox(height: 12), _AwaitingCard(n: r.awaitingReview)],
      ]);
    }
    final wide = MediaQuery.sizeOf(context).width >= 1000;
    final best = r.history.where((h) => h.percent != null).fold<double?>(null, (m, h) => m == null || h.percent! > m ? h.percent : m);

    final trend = Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('Score trend', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 4),
          const Text('Your percentage in each test, oldest first', style: TextStyle(color: Palette.ink2, fontSize: 13)),
          const SizedBox(height: 16),
          SizedBox(height: 200, child: _TrendChart(points: r.history.where((h) => h.percent != null).toList())),
        ]),
      ),
    );

    final subjects = Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('By subject', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 12),
          for (final s in r.subjects)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Row(children: [
                  Expanded(child: Text(s.name, style: const TextStyle(fontWeight: FontWeight.w600))),
                  Text('${formatPercent(s.averagePercent)} · ${s.tests} test${s.tests == 1 ? '' : 's'}', style: const TextStyle(color: Palette.ink2)),
                ]),
                const SizedBox(height: 6),
                ProgressBar(s.averagePercent / 100, color: Palette.subject(s.code), height: 10),
              ]),
            ),
        ]),
      ),
    );

    final topics = Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('Topics to revise', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 4),
          const Text('Where you lost the most marks', style: TextStyle(color: Palette.ink2, fontSize: 13)),
          const SizedBox(height: 10),
          if (r.topics.isEmpty)
            const Text('Nothing stands out. Keep going!', style: TextStyle(color: Palette.ink2))
          else
            for (final t in r.topics)
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: SubjectBadge(code: t.subjectCode, size: 36),
                title: Text(t.topic, style: const TextStyle(fontWeight: FontWeight.w600)),
                subtitle: Text('${t.wrong} wrong of ${t.asked} asked'),
              ),
          TextButton(onPressed: () => AppShell.go(context, ShellTab.practice), child: const Text('Practise these chapters')),
        ]),
      ),
    );

    final history = Card(
      child: Column(children: [
        const ListTile(title: Text('All tests', style: TextStyle(fontWeight: FontWeight.w700))),
        for (final h in r.history.reversed)
          ListTile(
            leading: SubjectBadge(code: h.subjectCode, size: 36, icon: Icons.assignment_outlined),
            title: Text(h.title),
            subtitle: Text(h.submittedAt == null ? '' : formatDay(h.submittedAt!)),
            trailing: Text(h.percent == null ? 'Pending' : formatPercent(h.percent), style: const TextStyle(fontWeight: FontWeight.w600)),
          ),
      ]),
    );

    final kpis = [
      MetricCard(label: 'Average score', value: formatPercent(r.averagePercent), progress: (r.averagePercent ?? 0) / 100),
      MetricCard(label: 'Tests taken', value: '${r.testsTaken}', tile: 1),
      MetricCard(label: 'Best score', value: formatPercent(best), progress: (best ?? 0) / 100, tile: 2),
    ];

    return PageBody(children: [
      if (r.awaitingReview > 0) ...[_AwaitingCard(n: r.awaitingReview), const SizedBox(height: 14)],
      LayoutBuilder(
        builder: (context, c) => c.maxWidth < 560
            ? Column(children: [for (final k in kpis) Padding(padding: const EdgeInsets.only(bottom: 10), child: k)])
            : Row(children: [for (var i = 0; i < kpis.length; i++) ...[if (i > 0) const SizedBox(width: 12), Expanded(child: kpis[i])]]),
      ),
      const SizedBox(height: 16),
      if (wide)
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(flex: 3, child: Column(children: [trend, const SizedBox(height: 16), history])),
          const SizedBox(width: 16),
          Expanded(flex: 2, child: Column(children: [subjects, const SizedBox(height: 16), topics])),
        ])
      else ...[trend, const SizedBox(height: 16), subjects, const SizedBox(height: 16), topics, const SizedBox(height: 16), history],
    ]);
  }
}

class _AwaitingCard extends StatelessWidget {
  const _AwaitingCard({required this.n});
  final int n;

  @override
  Widget build(BuildContext context) => Card(
        color: Palette.warnSoft,
        child: ListTile(
          leading: const Icon(Icons.hourglass_top, color: Palette.warn),
          title: Text('$n test${n == 1 ? '' : 's'} waiting for your teacher to check'),
          subtitle: const Text('Answers that arrived after a test closed are checked before they count.'),
        ),
      );
}

class _TrendChart extends StatelessWidget {
  const _TrendChart({required this.points});
  final List<HistoryPoint> points;

  @override
  Widget build(BuildContext context) {
    if (points.length < 2) {
      return const Center(child: Text('Take one more test to see a trend.', style: TextStyle(color: Palette.ink2)));
    }
    return Semantics(
      label: 'Scores: ${points.map((p) => '${p.title} ${formatPercent(p.percent)}').join(', ')}',
      child: CustomPaint(painter: _TrendPainter(points.map((p) => p.percent!).toList()), size: Size.infinite),
    );
  }
}

class _TrendPainter extends CustomPainter {
  _TrendPainter(this.values);
  final List<double> values;

  @override
  void paint(Canvas canvas, Size size) {
    const left = 34.0, bottom = 18.0;
    final w = size.width - left - 8, h = size.height - bottom - 8;
    final grid = Paint()
      ..color = Palette.line
      ..strokeWidth = 1;
    final tp = TextPainter(textDirection: TextDirection.ltr);
    for (final g in [0, 25, 50, 75, 100]) {
      final y = 8 + h - h * g / 100;
      canvas.drawLine(Offset(left, y), Offset(left + w, y), grid);
      tp.text = TextSpan(text: '$g', style: const TextStyle(color: Palette.ink3, fontSize: 11));
      tp.layout();
      tp.paint(canvas, Offset(left - tp.width - 6, y - tp.height / 2));
    }
    Offset at(int i) => Offset(left + w * i / (values.length - 1), 8 + h - h * values[i].clamp(0, 100) / 100);
    final path = Path()..moveTo(at(0).dx, at(0).dy);
    for (var i = 1; i < values.length; i++) {
      path.lineTo(at(i).dx, at(i).dy);
    }
    final fill = Path.from(path)
      ..lineTo(at(values.length - 1).dx, 8 + h)
      ..lineTo(left, 8 + h)
      ..close();
    canvas.drawPath(fill, Paint()..color = Palette.board.withValues(alpha: 0.08));
    canvas.drawPath(
      path,
      Paint()
        ..color = Palette.board
        ..strokeWidth = 2.5
        ..style = PaintingStyle.stroke
        ..strokeJoin = StrokeJoin.round,
    );
    for (var i = 0; i < values.length; i++) {
      canvas.drawCircle(at(i), 4.5, Paint()..color = Palette.surface);
      canvas.drawCircle(
        at(i),
        4.5,
        Paint()
          ..color = i == values.length - 1 ? Palette.marigold : Palette.board
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2.5,
      );
    }
  }

  @override
  bool shouldRepaint(_TrendPainter old) => old.values != values;
}
