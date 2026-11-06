const _months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const _monthsLong = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const _days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

String _two(int n) => n.toString().padLeft(2, '0');

String formatTime(DateTime d) {
  final l = d.toLocal();
  final h = l.hour % 12 == 0 ? 12 : l.hour % 12;
  return '$h:${_two(l.minute)} ${l.hour < 12 ? 'am' : 'pm'}';
}

/// "HH:MM" (24 h) → "8:30 am"
String formatClock(String hhmm) {
  final p = hhmm.split(':');
  if (p.length != 2) return hhmm;
  final h = int.tryParse(p[0]) ?? 0;
  final h12 = h % 12 == 0 ? 12 : h % 12;
  return '$h12:${p[1]} ${h < 12 ? 'am' : 'pm'}';
}

String formatDateTime(DateTime d) {
  final l = d.toLocal();
  return '${l.day} ${_months[l.month - 1]}, ${formatTime(l)}';
}

String formatDay(DateTime d) {
  final l = d.toLocal();
  return '${_days[l.weekday - 1]}, ${l.day} ${_months[l.month - 1]}';
}

String formatDate(String isoDate) {
  final d = DateTime.tryParse(isoDate);
  return d == null ? isoDate : '${d.day} ${_months[d.month - 1]} ${d.year}';
}

String formatMonth(String yyyymm) {
  final p = yyyymm.split('-');
  if (p.length != 2) return yyyymm;
  final m = int.tryParse(p[1]) ?? 1;
  return '${_monthsLong[(m - 1).clamp(0, 11)]} ${p[0]}';
}

/// "Due today, 9:00 pm" / "Due Sat, 2 Nov" style labels.
String formatDue(DateTime d, {DateTime? now}) {
  final n = (now ?? DateTime.now()).toLocal();
  final l = d.toLocal();
  final sameDay = l.year == n.year && l.month == n.month && l.day == n.day;
  final tomorrow = n.add(const Duration(days: 1));
  if (sameDay) return 'today, ${formatTime(l)}';
  if (l.year == tomorrow.year && l.month == tomorrow.month && l.day == tomorrow.day) return 'tomorrow, ${formatTime(l)}';
  return formatDay(l);
}

String formatAgo(DateTime d, {DateTime? now}) {
  final diff = (now ?? DateTime.now()).difference(d);
  if (diff.inSeconds < 60) return 'just now';
  if (diff.inMinutes < 60) return '${diff.inMinutes} min ago';
  if (diff.inHours < 24) return '${diff.inHours} h ago';
  if (diff.inDays < 7) return '${diff.inDays} d ago';
  return formatDay(d);
}

String formatCountdown(int seconds) {
  final s = seconds < 0 ? 0 : seconds;
  final h = s ~/ 3600;
  final m = (s % 3600) ~/ 60;
  final r = s % 60;
  return h > 0 ? '$h:${_two(m)}:${_two(r)}' : '$m:${_two(r)}';
}

String formatBytes(int? n) {
  if (n == null || n <= 0) return '';
  if (n < 1024 * 1024) return '${(n / 1024).ceil()} KB';
  return '${(n / 1024 / 1024).toStringAsFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB';
}

String formatPercent(double? p) => p == null ? '—' : '${p % 1 == 0 ? p.toInt() : p.toStringAsFixed(1)}%';

String greeting(DateTime now) {
  final h = now.hour;
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

String initials(String name) {
  final parts = name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
  if (parts.isEmpty) return '?';
  return (parts.first[0] + (parts.length > 1 ? parts.last[0] : '')).toUpperCase();
}
