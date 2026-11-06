import 'package:flutter/material.dart';
import 'package:flutter_math_fork/flutter_math.dart';

import 'theme.dart';

/// Question text in GenPrep's format: maths as $...$ (inline) or $$...$$ (own line),
/// pictures as {{IMG::https://...}}, **bold**, and line breaks.
class MathText extends StatelessWidget {
  const MathText(this.text, {super.key, this.style, this.images = const []});
  final String text;
  final TextStyle? style;

  /// Extra pictures shown under the text (a question's separate image list).
  final List<String> images;

  static final _img = RegExp(r'\{\{IMG::([^}]+?)\}\}');
  static final _maths = RegExp(r'(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)');
  static final _bold = RegExp(r'(\*\*[^*]+\*\*)');

  @override
  Widget build(BuildContext context) {
    final base = style ?? DefaultTextStyle.of(context).style;
    final blocks = <Widget>[];
    var last = 0;
    for (final m in _img.allMatches(text)) {
      if (m.start > last) blocks.add(_rich(text.substring(last, m.start), base));
      final url = m.group(1)!.split('|').first.trim();
      if (url.startsWith('https://')) blocks.add(_Picture(url));
      last = m.end;
    }
    if (last < text.length) blocks.add(_rich(text.substring(last), base));
    for (final url in images) {
      if (url.startsWith('https://')) blocks.add(_Picture(url));
    }
    if (blocks.length == 1) return blocks.first;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: blocks);
  }

  Widget _rich(String s, TextStyle base) {
    final spans = <InlineSpan>[];
    for (final part in _split(s, _maths)) {
      final block = part.length > 4 && part.startsWith(r'$$') && part.endsWith(r'$$');
      final inline = !block && part.length > 2 && part.startsWith(r'$') && part.endsWith(r'$');
      if (block || inline) {
        final tex = block ? part.substring(2, part.length - 2) : part.substring(1, part.length - 1);
        final math = Math.tex(
          tex,
          mathStyle: block ? MathStyle.display : MathStyle.text,
          textStyle: base,
          onErrorFallback: (_) => Text(part, style: base),
        );
        spans.add(block
            ? WidgetSpan(child: SizedBox(width: double.infinity, child: Center(child: Padding(padding: const EdgeInsets.symmetric(vertical: 6), child: math))))
            : WidgetSpan(alignment: PlaceholderAlignment.middle, child: math));
      } else {
        for (final b in _split(part, _bold)) {
          final isBold = b.length > 4 && b.startsWith('**') && b.endsWith('**');
          spans.add(TextSpan(text: isBold ? b.substring(2, b.length - 2) : b, style: isBold ? base.copyWith(fontWeight: FontWeight.w600) : base));
        }
      }
    }
    return Text.rich(TextSpan(children: spans), style: base);
  }

  /// Splits keeping the matches, like JavaScript's split with a capture group.
  static List<String> _split(String s, RegExp re) {
    final out = <String>[];
    var i = 0;
    for (final m in re.allMatches(s)) {
      if (m.start > i) out.add(s.substring(i, m.start));
      out.add(m.group(0)!);
      i = m.end;
    }
    if (i < s.length) out.add(s.substring(i));
    return out;
  }
}

class _Picture extends StatelessWidget {
  const _Picture(this.url);
  final String url;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(10),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxHeight: 280),
          child: Image.network(
            url,
            fit: BoxFit.contain,
            loadingBuilder: (_, child, p) => p == null ? child : const SizedBox(height: 120, child: Center(child: CircularProgressIndicator(strokeWidth: 2))),
            errorBuilder: (_, __, ___) => Container(
              height: 80,
              color: Palette.sunk,
              alignment: Alignment.center,
              child: const Text('Picture needs Wi-Fi', style: TextStyle(color: Palette.ink3)),
            ),
          ),
        ),
      ),
    );
  }
}
