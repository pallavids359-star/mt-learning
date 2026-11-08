import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/app_scope.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import '../prep/exam_choice.dart';
import '../shell/app_shell.dart';

class ProfilePage extends StatelessWidget {
  const ProfilePage({super.key});

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final p = app.home?.profile;
    final t = Theme.of(context).textTheme;

    Widget row(String label, String? value) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 7),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            SizedBox(width: 140, child: Text(label, style: const TextStyle(color: Palette.ink2))),
            Expanded(child: Text(value ?? '—', style: const TextStyle(fontWeight: FontWeight.w600))),
          ]),
        );

    return PageBody(maxWidth: 760, children: [
      Card(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Row(children: [
            CircleAvatar(
              radius: 38,
              backgroundColor: Palette.boardSoft,
              backgroundImage: app.photo != null ? MemoryImage(app.photo!) : null,
              child: app.photo == null
                  ? Text(initials(p?.fullName ?? ''), style: const TextStyle(fontSize: 24, color: Palette.board, fontWeight: FontWeight.w600))
                  : null,
            ),
            const SizedBox(width: 18),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(p?.fullName ?? app.lastStudentName ?? '', style: t.titleLarge),
                Text(p == null ? '' : '${p.studentCode} · Roll ${p.rollNumber}', style: const TextStyle(color: Palette.ink2)),
                const SizedBox(height: 6),
                if (p != null) Pill('${p.pucLabel} ${p.stream} · ${p.sectionName}', tone: PillTone.board),
              ]),
            ),
          ]),
        ),
      ),
      const SizedBox(height: 14),
      if (p != null)
        Card(
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Text('Details', style: t.titleMedium),
              const SizedBox(height: 6),
              row('Class', p.className),
              row('Academic year', p.academicYear),
              row('Hostel', p.hostelName == null ? null : '${p.hostelName}${p.roomNumber != null ? ', room ${p.roomNumber}' : ''}'),
              row('Guardian', p.guardianName),
              row('Tablet', app.tabletSerial ?? p.tabletSerial),
              const SizedBox(height: 6),
              const Text('If something here is wrong, tell the college office.', style: TextStyle(color: Palette.ink3, fontSize: 13)),
            ]),
          ),
        ),
      const SizedBox(height: 14),
      Card(
        child: Column(children: [
          if (app.exam != null) ...[
            ListTile(
              leading: const Icon(Icons.school_outlined),
              title: const Text('Exam I am preparing for'),
              subtitle: Text(app.exam!.name),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => changeExam(context),
            ),
            const Divider(),
          ],
          ListTile(
            leading: const Icon(Icons.pin_outlined),
            title: Text(app.lastHasPin || (p?.hasPin ?? false) ? 'Change PIN' : 'Set a PIN'),
            subtitle: const Text('Sign in faster on this tablet with 4 to 6 digits'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => showDialog<void>(context: context, builder: (_) => const _PinDialog()),
          ),
          const Divider(),
          ListTile(
            leading: const Icon(Icons.lock_outline),
            title: const Text('Change password'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => showDialog<void>(context: context, builder: (_) => const _PasswordDialog()),
          ),
          const Divider(),
          ListTile(
            leading: const Icon(Icons.sync),
            title: const Text('Sync now'),
            subtitle: Text(app.lastSyncedAt == null ? 'Not synced yet' : 'Last synced ${formatAgo(app.lastSyncedAt!)}'),
            onTap: () async {
              final ok = await app.sync();
              if (context.mounted) showSnack(context, ok ? 'Up to date' : 'Could not reach the college server');
            },
          ),
          const Divider(),
          ListTile(
            leading: const Icon(Icons.logout, color: Palette.bad),
            title: const Text('Sign out', style: TextStyle(color: Palette.bad, fontWeight: FontWeight.w600)),
            onTap: () => _signOut(context),
          ),
        ]),
      ),
    ]);
  }

  Future<void> _signOut(BuildContext context) async {
    final app = AppScope.read(context);
    final pending = app.pendingUploads;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Sign out?'),
        content: Text(pending > 0
            ? '$pending finished test${pending == 1 ? ' has' : 's have'} not uploaded yet. They stay safely on this tablet and upload the next time you sign in.'
            : 'Your practice history is saved at the college, so nothing is lost.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Palette.bad),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Sign out'),
          ),
        ],
      ),
    );
    if (ok == true) await app.signOut();
  }
}

class _PinDialog extends StatefulWidget {
  const _PinDialog();

  @override
  State<_PinDialog> createState() => _PinDialogState();
}

class _PinDialogState extends State<_PinDialog> {
  final _form = GlobalKey<FormState>();
  final _password = TextEditingController();
  final _pin = TextEditingController();
  final _confirm = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _password.dispose();
    _pin.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await AppScope.read(context).setPin(_password.text, _pin.text);
      if (!mounted) return;
      Navigator.pop(context);
      showSnack(context, 'PIN saved');
    } catch (e) {
      if (mounted) setState(() => _error = friendlyError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final digits = [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(6)];
    return AlertDialog(
      title: const Text('Set a PIN'),
      content: SizedBox(
        width: 380,
        child: Form(
          key: _form,
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            ErrorText(_error),
            TextFormField(
              controller: _password,
              obscureText: true,
              decoration: const InputDecoration(labelText: 'Your password'),
              validator: (v) => (v == null || v.isEmpty) ? 'Enter your password' : null,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _pin,
              obscureText: true,
              keyboardType: TextInputType.number,
              inputFormatters: digits,
              decoration: const InputDecoration(labelText: 'New PIN (4 to 6 digits)'),
              validator: (v) => pinRule.hasMatch(v ?? '') ? null : 'Use 4 to 6 digits',
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _confirm,
              obscureText: true,
              keyboardType: TextInputType.number,
              inputFormatters: digits,
              decoration: const InputDecoration(labelText: 'Type the PIN again'),
              validator: (v) => v == _pin.text ? null : 'The PINs do not match',
            ),
          ]),
        ),
      ),
      actions: [
        TextButton(onPressed: _busy ? null : () => Navigator.pop(context), child: const Text('Cancel')),
        FilledButton(onPressed: _busy ? null : _save, child: const Text('Save PIN')),
      ],
    );
  }
}

class _PasswordDialog extends StatefulWidget {
  const _PasswordDialog();

  @override
  State<_PasswordDialog> createState() => _PasswordDialogState();
}

class _PasswordDialogState extends State<_PasswordDialog> {
  final _form = GlobalKey<FormState>();
  final _current = TextEditingController();
  final _next = TextEditingController();
  final _confirm = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _current.dispose();
    _next.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await AppScope.read(context).changePassword(_current.text, _next.text);
      if (!mounted) return;
      Navigator.pop(context);
      showSnack(context, 'Password changed');
    } catch (e) {
      if (mounted) setState(() => _error = friendlyError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Change password'),
      content: SizedBox(
        width: 380,
        child: Form(
          key: _form,
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            ErrorText(_error),
            TextFormField(
              controller: _current,
              obscureText: true,
              decoration: const InputDecoration(labelText: 'Current password'),
              validator: (v) => (v == null || v.isEmpty) ? 'Enter your current password' : null,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _next,
              obscureText: true,
              decoration: const InputDecoration(labelText: 'New password', helperText: 'At least 8 characters with a letter and a number'),
              validator: (v) => passwordRule.hasMatch(v ?? '') ? null : 'At least 8 characters with a letter and a number',
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _confirm,
              obscureText: true,
              decoration: const InputDecoration(labelText: 'Type it again'),
              validator: (v) => v == _next.text ? null : 'The passwords do not match',
            ),
          ]),
        ),
      ),
      actions: [
        TextButton(onPressed: _busy ? null : () => Navigator.pop(context), child: const Text('Cancel')),
        FilledButton(onPressed: _busy ? null : _save, child: const Text('Change')),
      ],
    );
  }
}
