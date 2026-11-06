import 'package:flutter/material.dart';

import '../../core/app_scope.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';

/// Shown after signing in with a temporary password issued by the college.
class ChangePasswordScreen extends StatefulWidget {
  const ChangePasswordScreen({super.key});

  @override
  State<ChangePasswordScreen> createState() => _ChangePasswordScreenState();
}

class _ChangePasswordScreenState extends State<ChangePasswordScreen> {
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

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await AppScope.read(context).changePassword(_current.text, _next.text);
    } catch (e) {
      if (mounted) setState(() => _error = friendlyError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AuthFrame(
      title: 'Choose your password',
      subtitle: 'You signed in with a temporary password',
      children: [
        Text(
          'Pick a password only you know. Use at least 8 characters with a letter and a number.',
          style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: Palette.ink2),
        ),
        const SizedBox(height: 18),
        ErrorText(_error),
        Form(
          key: _form,
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            TextFormField(
              controller: _current,
              obscureText: true,
              decoration: const InputDecoration(labelText: 'Temporary password'),
              validator: (v) => (v == null || v.isEmpty) ? 'Enter the password from your slip' : null,
            ),
            const SizedBox(height: 14),
            TextFormField(
              controller: _next,
              obscureText: true,
              decoration: const InputDecoration(labelText: 'New password'),
              validator: (v) => (v == null || !passwordRule.hasMatch(v)) ? 'At least 8 characters, with a letter and a number' : null,
            ),
            const SizedBox(height: 14),
            TextFormField(
              controller: _confirm,
              obscureText: true,
              decoration: const InputDecoration(labelText: 'Type the new password again'),
              validator: (v) => v != _next.text ? 'The passwords do not match' : null,
              onFieldSubmitted: (_) => _submit(),
            ),
            const SizedBox(height: 22),
            FilledButton(onPressed: _busy ? null : _submit, child: Text(_busy ? 'Saving…' : 'Save password')),
            const SizedBox(height: 8),
            TextButton(onPressed: _busy ? null : () => AppScope.read(context).signOut(), child: const Text('Sign out')),
          ]),
        ),
      ],
    );
  }
}
