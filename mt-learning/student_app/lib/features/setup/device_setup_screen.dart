import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/app_scope.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';

/// First-run screen for the device administrator. It records this tablet's serial number
/// (the server checks that students sign in on their own tablet) and the staff PIN that
/// unlocks the kiosk lock.
class DeviceSetupScreen extends StatefulWidget {
  const DeviceSetupScreen({super.key});

  @override
  State<DeviceSetupScreen> createState() => _DeviceSetupScreenState();
}

/// The staff PIN: 6 to 8 digits, so students cannot guess it easily.
final adminPinRule = RegExp(r'^\d{6,8}$');

class _DeviceSetupScreenState extends State<DeviceSetupScreen> {
  final _form = GlobalKey<FormState>();
  late final TextEditingController _serial;
  late final TextEditingController _confirm;
  final _pin = TextEditingController();
  final _pinAgain = TextEditingController();
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    final saved = AppScope.read(context).tabletSerial ?? '';
    _serial = TextEditingController(text: saved);
    _confirm = TextEditingController(text: saved);
  }

  @override
  void dispose() {
    _serial.dispose();
    _confirm.dispose();
    _pin.dispose();
    _pinAgain.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    setState(() => _busy = true);
    await AppScope.read(context).completeDeviceSetup(_serial.text, adminPin: _pin.text);
  }

  @override
  Widget build(BuildContext context) {
    final pinInput = [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(8)];
    return AuthFrame(
      title: 'Set up this tablet',
      subtitle: 'For the college device administrator',
      children: [
        Text(
          'Enter the serial number exactly as it was enrolled in the admin portal. '
          'Find it in Settings → About tablet → Status. This is asked only once.',
          style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: Palette.ink2),
        ),
        const SizedBox(height: 20),
        Form(
          key: _form,
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            TextFormField(
              controller: _serial,
              decoration: const InputDecoration(labelText: 'Tablet serial number'),
              textCapitalization: TextCapitalization.characters,
              autocorrect: false,
              validator: (v) => (v == null || v.trim().length < 3) ? 'Enter the serial number' : null,
            ),
            const SizedBox(height: 14),
            TextFormField(
              controller: _confirm,
              decoration: const InputDecoration(labelText: 'Type it again to confirm'),
              textCapitalization: TextCapitalization.characters,
              autocorrect: false,
              validator: (v) =>
                  v?.trim().toUpperCase() != _serial.text.trim().toUpperCase() ? 'The serial numbers do not match' : null,
            ),
            const SizedBox(height: 22),
            Text('Staff PIN', style: Theme.of(context).textTheme.titleSmall),
            const SizedBox(height: 4),
            Text(
              'Staff use this PIN to unlock the tablet, for example to change Wi-Fi. '
              'Use 6 to 8 digits and keep it away from students.',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(color: Palette.ink2),
            ),
            const SizedBox(height: 12),
            TextFormField(
              key: const Key('adminPin'),
              controller: _pin,
              obscureText: true,
              keyboardType: TextInputType.number,
              inputFormatters: pinInput,
              decoration: const InputDecoration(labelText: 'Staff PIN'),
              validator: (v) => adminPinRule.hasMatch(v ?? '') ? null : 'Use 6 to 8 digits',
            ),
            const SizedBox(height: 14),
            TextFormField(
              key: const Key('adminPinAgain'),
              controller: _pinAgain,
              obscureText: true,
              keyboardType: TextInputType.number,
              inputFormatters: pinInput,
              decoration: const InputDecoration(labelText: 'Type the staff PIN again'),
              validator: (v) => v != _pin.text ? 'The PINs do not match' : null,
              onFieldSubmitted: (_) => _save(),
            ),
            const SizedBox(height: 22),
            FilledButton(onPressed: _busy ? null : _save, child: const Text('Save and continue')),
          ]),
        ),
      ],
    );
  }
}
