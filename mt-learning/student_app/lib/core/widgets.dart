import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../data/api_client.dart';
import 'theme.dart';

/// The green "MT" mark shared with the admin portal.
class BrandMark extends StatelessWidget {
  const BrandMark({super.key, this.size = 44, this.background = Palette.board, this.foreground = Colors.white});
  final double size;
  final Color background;
  final Color foreground;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(color: background, borderRadius: BorderRadius.circular(size * 0.3)),
      alignment: Alignment.center,
      child: Text('MT', style: TextStyle(color: foreground, fontWeight: FontWeight.w700, fontSize: size * 0.36, letterSpacing: 0.4)),
    );
  }
}

/// Split layout for setup, sign-in and password screens: a green panel with the
/// app's promise on wide screens, a header strip on narrow ones, and the form.
class AuthFrame extends StatelessWidget {
  const AuthFrame({super.key, required this.title, this.subtitle, required this.children});
  final String title;
  final String? subtitle;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final form = Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(28),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 400),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            if (subtitle != null) Text(subtitle!, style: t.bodyMedium?.copyWith(color: Palette.ink2, fontWeight: FontWeight.w600)),
            Text(title, style: t.headlineSmall),
            const SizedBox(height: 22),
            ...children,
          ]),
        ),
      ),
    );
    return Scaffold(
      backgroundColor: Palette.surface,
      body: LayoutBuilder(builder: (context, c) {
        final wide = c.maxWidth >= 820;
        final art = Container(
          width: double.infinity,
          color: Palette.board,
          padding: EdgeInsets.fromLTRB(40, 40 + MediaQuery.paddingOf(context).top, 40, wide ? 40 : 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisAlignment: wide ? MainAxisAlignment.spaceBetween : MainAxisAlignment.start,
            children: [
              Row(children: [
                const BrandMark(size: 42, background: Colors.white, foreground: Palette.board),
                const SizedBox(width: 12),
                const Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('MT Learning', style: TextStyle(color: Colors.white, fontSize: 21, fontWeight: FontWeight.w600)),
                  Text('Student app', style: TextStyle(color: Color(0xFFCFE6DC), fontSize: 13.5)),
                ]),
              ]),
              if (wide)
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('Practise every day.\nDo well in the exam.',
                      style: t.displaySmall?.copyWith(color: Colors.white, fontWeight: FontWeight.w600, height: 1.08, letterSpacing: -0.8)),
                  const SizedBox(height: 16),
                  Text('NEET, JEE and KCET practice, full mock tests and your college live tests, all on this tablet.',
                      style: t.titleMedium?.copyWith(color: Colors.white.withValues(alpha: 0.85), fontWeight: FontWeight.w400, height: 1.45)),
                ]),
              if (wide)
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  for (final f in ['Practise any chapter at your own pace', 'Take full mock tests with real timing', 'See your marks and what to work on'])
                    Padding(
                      padding: const EdgeInsets.only(top: 10),
                      child: Row(children: [
                        Container(
                          width: 28,
                          height: 28,
                          decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.13), borderRadius: BorderRadius.circular(12)),
                          child: const Icon(Icons.check, size: 16, color: Colors.white),
                        ),
                        const SizedBox(width: 10),
                        Text(f, style: const TextStyle(color: Colors.white, fontSize: 15.5)),
                      ]),
                    ),
                ]),
            ],
          ),
        );
        if (wide) return Row(children: [Expanded(flex: 11, child: art), Expanded(flex: 10, child: SafeArea(child: form))]);
        return Column(children: [art, Expanded(child: SafeArea(top: false, child: form))]);
      }),
    );
  }
}

class ErrorText extends StatelessWidget {
  const ErrorText(this.message, {super.key});
  final String? message;

  @override
  Widget build(BuildContext context) {
    if (message == null) return const SizedBox.shrink();
    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(color: Palette.badSoft, borderRadius: BorderRadius.circular(12)),
      child: Semantics(liveRegion: true, child: Text(message!, style: const TextStyle(color: Palette.bad, fontWeight: FontWeight.w500))),
    );
  }
}

/// A rounded square with the subject code (or an icon) in the subject's colour.
class SubjectBadge extends StatelessWidget {
  const SubjectBadge({super.key, required this.code, this.icon, this.size = 42});
  final String code;
  final IconData? icon;
  final double size;

  @override
  Widget build(BuildContext context) {
    final c = Palette.subject(code);
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(color: c.withValues(alpha: 0.13), borderRadius: BorderRadius.circular(size * 0.28)),
      alignment: Alignment.center,
      child: icon != null
          ? Icon(icon, color: c, size: size * 0.48)
          : Text(code, style: TextStyle(color: c, fontWeight: FontWeight.w600, fontSize: size * 0.28, letterSpacing: 0.3)),
    );
  }
}

enum PillTone { ok, warn, bad, neutral, board, live }

class Pill extends StatelessWidget {
  const Pill(this.label, {super.key, this.tone = PillTone.neutral, this.icon});
  final String label;
  final PillTone tone;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final (bg, fg) = switch (tone) {
      PillTone.ok => (Palette.okSoft, Palette.ok),
      PillTone.warn => (Palette.warnSoft, Palette.warn),
      PillTone.bad => (Palette.badSoft, Palette.bad),
      PillTone.board => (Palette.boardSoft, Palette.board),
      PillTone.live => (const Color(0xFFD6362A), Colors.white),
      PillTone.neutral => (Palette.sunk, Palette.ink2),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(99)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        if (icon != null) ...[Icon(icon, size: 14, color: fg), const SizedBox(width: 4)],
        Text(label, style: TextStyle(color: fg, fontWeight: FontWeight.w700, fontSize: 12.5)),
      ]),
    );
  }
}

class ProgressBar extends StatelessWidget {
  const ProgressBar(this.value, {super.key, this.color = Palette.teal, this.height = 8, this.background = Palette.sunk});
  final double value; // 0–1
  final Color color;
  final double height;
  final Color background;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(99),
      child: LinearProgressIndicator(value: value.clamp(0, 1).toDouble(), minHeight: height, backgroundColor: background, color: color),
    );
  }
}

class SectionTitle extends StatelessWidget {
  const SectionTitle(this.title, {super.key, this.action, this.onAction});
  final String title;
  final String? action;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return Row(children: [
      Expanded(child: Text(title, style: Theme.of(context).textTheme.titleLarge)),
      if (action != null) TextButton(onPressed: onAction, child: Text(action!)),
    ]);
  }
}

/// A plain white number card: big number, short label (the first one in green).
class MetricCard extends StatelessWidget {
  const MetricCard({super.key, required this.label, required this.value, this.progress, this.color = Palette.board, this.tile = 0});
  final String label;
  final String value;
  final double? progress;

  /// Kept for older callers.
  final Color color;
  final int tile;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 18),
      decoration: BoxDecoration(color: Palette.surface, borderRadius: BorderRadius.circular(14), border: Border.all(color: Palette.line)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(value, style: Theme.of(context).textTheme.headlineMedium?.copyWith(color: tile == 0 ? Palette.board : Palette.ink, fontWeight: FontWeight.w600)),
        const SizedBox(height: 2),
        Text(label, style: const TextStyle(color: Palette.ink2, fontSize: 15)),
        if (progress != null) ...[
          const SizedBox(height: 10),
          ProgressBar(progress!, color: Palette.board, background: Palette.sunk),
        ],
      ]),
    );
  }
}

/// A donut showing a percentage, e.g. attendance or a test score.
class Ring extends StatelessWidget {
  const Ring({super.key, required this.percent, required this.label, this.color = Palette.ok, this.size = 120});
  final double? percent;
  final String label;
  final Color color;
  final double size;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size,
      height: size,
      child: CustomPaint(
        painter: _RingPainter((percent ?? 0) / 100, color),
        child: Center(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Text(percent == null ? '—' : '${percent!.round()}%', style: TextStyle(fontSize: size * 0.22, fontWeight: FontWeight.w600)),
            Text(label, style: TextStyle(fontSize: size * 0.1, color: Palette.ink2)),
          ]),
        ),
      ),
    );
  }
}

class _RingPainter extends CustomPainter {
  _RingPainter(this.fraction, this.color);
  final double fraction;
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final stroke = size.width * 0.11;
    final rect = Offset(stroke / 2, stroke / 2) & Size(size.width - stroke, size.height - stroke);
    final track = Paint()
      ..color = Palette.sunk
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke;
    final arc = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round
      ..strokeWidth = stroke;
    canvas.drawArc(rect, 0, math.pi * 2, false, track);
    if (fraction > 0) canvas.drawArc(rect, -math.pi / 2, math.pi * 2 * fraction.clamp(0, 1), false, arc);
  }

  @override
  bool shouldRepaint(_RingPainter old) => old.fraction != fraction || old.color != color;
}

class EmptyState extends StatelessWidget {
  const EmptyState({super.key, required this.icon, required this.title, this.message, this.action});
  final IconData icon;
  final String title;
  final String? message;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 36),
      decoration: BoxDecoration(border: Border.all(color: Palette.line, width: 1.5), borderRadius: BorderRadius.circular(12)),
      child: Column(children: [
        Icon(icon, size: 36, color: Palette.ink3),
        const SizedBox(height: 10),
        Text(title, textAlign: TextAlign.center, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
        if (message != null) ...[
          const SizedBox(height: 4),
          Text(message!, textAlign: TextAlign.center, style: const TextStyle(color: Palette.ink2)),
        ],
        if (action != null) ...[const SizedBox(height: 14), action!],
      ]),
    );
  }
}

/// Turns any error into a sentence the student can act on.
String friendlyError(Object e) {
  if (e is ApiException || e is OfflineException || e is SessionExpiredException) return e.toString();
  return 'Something went wrong. Try again.';
}

void showSnack(BuildContext context, String message) =>
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));

/// Password rule shared with the server.
final passwordRule = RegExp(r'^(?=.*[A-Za-z])(?=.*\d).{8,128}$');
final pinRule = RegExp(r'^\d{4,6}$');
