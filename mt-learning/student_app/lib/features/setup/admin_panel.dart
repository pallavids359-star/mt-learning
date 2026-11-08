import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/app_scope.dart';
import '../../core/kiosk.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';

/// Staff-only panel, opened by pressing and holding the tablet number on the sign-in screen.
/// Asks for the staff PIN first. From here staff can change Wi-Fi, unlock the tablet for
/// maintenance, or remove kiosk mode before the tablet is reset or given away.
Future<void> openAdminPanel(BuildContext context) async {
  final ok = await showDialog<bool>(context: context, builder: (_) => const _PinCheck());
  if (ok == true && context.mounted) {
    await showDialog<void>(context: context, builder: (_) => const _AdminPanel());
  }
}

/// Wrong PINs in a row; after 5 the panel waits a minute before trying again.
int _failures = 0;
DateTime? _blockedUntil;

class _PinCheck extends StatefulWidget {
  const _PinCheck();

  @override
  State<_PinCheck> createState() => _PinCheckState();
}

class _PinCheckState extends State<_PinCheck> {
  final _pin = TextEditingController();
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    _pin.dispose();
    super.dispose();
  }

  Future<void> _check() async {
    final until = _blockedUntil;
    if (until != null && DateTime.now().isBefore(until)) {
      setState(() => _error = 'Too many wrong PINs. Wait a minute and try again.');
      return;
    }
    setState(() => _busy = true);
    final ok = await AppScope.read(context).checkAdminPin(_pin.text);
    if (!mounted) return;
    if (ok) {
      _failures = 0;
      Navigator.pop(context, true);
      return;
    }
    _failures++;
    if (_failures >= 5) {
      _failures = 0;
      _blockedUntil = DateTime.now().add(const Duration(minutes: 1));
    }
    _pin.clear();
    setState(() {
      _busy = false;
      _error = 'That is not the staff PIN.';
    });
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Staff only'),
      content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const Text('Enter the staff PIN to manage this tablet.', style: TextStyle(color: Palette.ink2)),
        const SizedBox(height: 14),
        ErrorText(_error),
        TextField(
          key: const Key('adminPinCheck'),
          controller: _pin,
          autofocus: true,
          obscureText: true,
          keyboardType: TextInputType.number,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(8)],
          decoration: const InputDecoration(labelText: 'Staff PIN'),
          onSubmitted: (_) => _check(),
        ),
      ]),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
        FilledButton(onPressed: _busy ? null : _check, child: const Text('Continue')),
      ],
    );
  }
}

class _AdminPanel extends StatefulWidget {
  const _AdminPanel();

  @override
  State<_AdminPanel> createState() => _AdminPanelState();
}

class _AdminPanelState extends State<_AdminPanel> {
  KioskStatus? _status;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    final s = await Kiosk.status();
    if (mounted) setState(() => _status = s);
  }

  Future<void> _run(Future<bool> Function() action, {String? done}) async {
    final ok = await action();
    await _refresh();
    if (!mounted) return;
    if (!ok) {
      showSnack(context, 'That did not work on this tablet.');
    } else if (done != null) {
      showSnack(context, done);
    }
  }

  Future<void> _remove() async {
    final sure = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Remove kiosk mode?'),
        content: const Text(
          'The tablet will work like a normal tablet, and students will be able to open other apps. '
          'Do this only before resetting the tablet or giving it away. '
          'To lock it again, it has to be set up again with a laptop.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Palette.bad),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Remove kiosk mode'),
          ),
        ],
      ),
    );
    if (sure == true) await _run(Kiosk.remove, done: 'Kiosk mode removed');
  }

  @override
  Widget build(BuildContext context) {
    final s = _status;
    final app = AppScope.of(context);
    final String state;
    if (s == null) {
      state = 'Checking…';
    } else if (!s.owner) {
      state = 'Kiosk mode is not set up on this tablet, so students can open other apps. '
          'See the tablet setup guide.';
    } else if (s.maintenance || !s.locked) {
      state = 'Unlocked for staff. Other apps can be opened. It locks again when you tap "Lock again" or the tablet restarts.';
    } else {
      state = 'Locked. Students can use only MT Learning.';
    }
    final locked = s != null && s.owner && s.locked && !s.maintenance;

    return AlertDialog(
      title: const Text('Manage this tablet'),
      content: SizedBox(
        width: 440,
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          if (app.tabletSerial != null) Text('Tablet ${app.tabletSerial}', style: const TextStyle(fontWeight: FontWeight.w600)),
          const SizedBox(height: 6),
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Icon(locked ? Icons.lock_outline : Icons.lock_open_outlined, color: locked ? Palette.ok : Palette.warn, size: 20),
            const SizedBox(width: 8),
            Expanded(child: Text(state, style: const TextStyle(color: Palette.ink2))),
          ]),
          const SizedBox(height: 16),
          OutlinedButton.icon(
            onPressed: () => _run(Kiosk.openWifiSettings),
            icon: const Icon(Icons.wifi),
            label: const Text('Wi-Fi settings'),
          ),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: () => _run(Kiosk.openSettings),
            icon: const Icon(Icons.settings_outlined),
            label: const Text('Tablet settings'),
          ),
          if (s != null && s.owner) ...[
            const SizedBox(height: 8),
            if (locked)
              OutlinedButton.icon(
                onPressed: () => _run(Kiosk.unlock, done: 'Unlocked for staff'),
                icon: const Icon(Icons.lock_open_outlined),
                label: const Text('Unlock for maintenance'),
              )
            else
              FilledButton.icon(
                onPressed: () => _run(Kiosk.lock, done: 'Tablet locked'),
                icon: const Icon(Icons.lock_outline),
                label: const Text('Lock again'),
              ),
            const SizedBox(height: 8),
            TextButton(
              onPressed: _remove,
              style: TextButton.styleFrom(foregroundColor: Palette.bad),
              child: const Text('Remove kiosk mode…'),
            ),
          ],
        ]),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Close')),
      ],
    );
  }
}
