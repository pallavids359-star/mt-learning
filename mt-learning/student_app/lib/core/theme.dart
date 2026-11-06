import 'package:flutter/material.dart';

/// "Calm & Simple" palette, shared with the admin portal: one deep green for actions,
/// quiet greys, white menus and cards, and one colour per subject.
class Palette {
  static const bg = Color(0xFFF6F7F5);
  static const surface = Color(0xFFFFFFFF);
  static const sunk = Color(0xFFF1F3F1);
  static const ink = Color(0xFF1C2421);
  static const ink2 = Color(0xFF4F5A55);
  static const ink3 = Color(0xFF6B7570);
  static const line = Color(0xFFE3E7E4);
  static const board = Color(0xFF0E6B4E); // deep green: main colour
  static const board2 = Color(0xFF0A5139);
  static const boardSoft = Color(0xFFE8F3EE);
  static const marigold = Color(0xFFB4530F); // warm orange: "marked for review" and saved questions
  static const marigoldSoft = Color(0xFFFBEDE3);
  static const ok = Color(0xFF0E6B4E);
  static const okSoft = Color(0xFFE8F3EE);
  static const warn = Color(0xFF9A3F0A);
  static const warnSoft = Color(0xFFFBEDE3);
  static const bad = Color(0xFFA1271B);
  static const teal = Color(0xFF0E6B4E); // buttons and links
  static const tealSoft = Color(0xFFE8F3EE);

  /// Calm solid colours for the few coloured cards (no bright gradients).
  static const tiles = [
    [Color(0xFF0E6B4E), Color(0xFF0E6B4E)],
    [Color(0xFF2D5F6B), Color(0xFF2D5F6B)],
    [Color(0xFF3F4A45), Color(0xFF3F4A45)],
    [Color(0xFF5B4E7A), Color(0xFF5B4E7A)],
  ];
  static const badSoft = Color(0xFFFBEAE8);

  static const _subjects = {
    'PHY': Color(0xFF3F6FD8),
    'CHE': Color(0xFF138A83),
    'MAT': Color(0xFF6B4FD1),
    'BIO': Color(0xFF3B8B3A),
    'ENG': Color(0xFFC2456B),
    'KAN': Color(0xFFC0811A),
  };
  static const _fallback = [Color(0xFF3F6FD8), Color(0xFF138A83), Color(0xFF6B4FD1), Color(0xFF3B8B3A), Color(0xFFC2456B), Color(0xFFC0811A)];

  static Color subject(String code) {
    final c = _subjects[code];
    if (c != null) return c;
    var h = 0;
    for (final u in code.codeUnits) {
      h = (h * 31 + u) & 0x7fffffff;
    }
    return _fallback[h % _fallback.length];
  }
}

ThemeData buildTheme() {
  final scheme = ColorScheme.fromSeed(
    seedColor: Palette.teal,
    primary: Palette.teal,
    onPrimary: Colors.white,
    secondary: Palette.board2,
    surface: Palette.surface,
    onSurface: Palette.ink,
    error: Palette.bad,
  );
  final base = ThemeData(colorScheme: scheme, useMaterial3: true, scaffoldBackgroundColor: Palette.bg);
  final text = base.textTheme.apply(bodyColor: Palette.ink, displayColor: Palette.ink);
  final radius = BorderRadius.circular(10);

  return base.copyWith(
    textTheme: text.copyWith(
      headlineLarge: text.headlineLarge?.copyWith(fontWeight: FontWeight.w600),
      headlineMedium: text.headlineMedium?.copyWith(fontWeight: FontWeight.w600),
      headlineSmall: text.headlineSmall?.copyWith(fontWeight: FontWeight.w600),
      titleLarge: text.titleLarge?.copyWith(fontWeight: FontWeight.w600),
      titleMedium: text.titleMedium?.copyWith(fontWeight: FontWeight.w600),
      bodyLarge: text.bodyLarge?.copyWith(fontSize: 16.5),
      bodyMedium: text.bodyMedium?.copyWith(fontSize: 15.5),
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: Palette.surface,
      foregroundColor: Palette.ink,
      elevation: 0,
      scrolledUnderElevation: 0,
      shape: Border(bottom: BorderSide(color: Palette.line)),
    ),
    cardTheme: CardThemeData(
      color: Palette.surface,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16), side: const BorderSide(color: Palette.line)),
    ),
    dividerTheme: const DividerThemeData(color: Palette.line, space: 1, thickness: 1),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Palette.surface,
      border: OutlineInputBorder(borderRadius: radius, borderSide: const BorderSide(color: Palette.line)),
      enabledBorder: OutlineInputBorder(borderRadius: radius, borderSide: const BorderSide(color: Palette.line)),
      focusedBorder: OutlineInputBorder(borderRadius: radius, borderSide: const BorderSide(color: Palette.teal, width: 2)),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(0, 48),
        padding: const EdgeInsets.symmetric(horizontal: 20),
        shape: RoundedRectangleBorder(borderRadius: radius),
        textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(0, 44),
        foregroundColor: Palette.ink,
        side: const BorderSide(color: Color(0xFFC9D1CD)),
        shape: RoundedRectangleBorder(borderRadius: radius),
        textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w500),
      ),
    ),
    chipTheme: base.chipTheme.copyWith(shape: const StadiumBorder(), side: const BorderSide(color: Palette.line)),
    snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating),
  );
}
