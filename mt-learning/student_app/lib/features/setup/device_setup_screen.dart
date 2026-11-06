import 'package:flutter/material.dart';

import '../../core/app_scope.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';

/// First-run screen for the device administrator: records this tablet's serial number,
/// which the server uses to check that students sign in on their own tablet.
class DeviceSetupScreen extends StatefulWidget {
  const DeviceSetupScreen({super.key});

  @override
  State<DeviceSetupScreen> createState() => _DeviceSetupScreenState();
}

class _DeviceSetupScreenState extends State<DeviceSetupScreen> {
  final _form = GlobalKey<FormState>();
  final _serial = TextEditingController();
  final _confirm = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _serial.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    setState(() => _busy = true);
    await AppScope.read(context).completeDeviceSetup(_serial.text);
  }

  @override
  Widget build(BuildContext context) {
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
