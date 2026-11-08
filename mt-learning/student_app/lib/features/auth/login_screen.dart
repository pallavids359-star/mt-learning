import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/app_scope.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import '../setup/admin_panel.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _form = GlobalKey<FormState>();
  late final TextEditingController _code;
  final _secret = TextEditingController();
  bool _usePin = false;
  bool _obscure = true;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final app = AppScope.read(context);
    _code = TextEditingController(text: app.lastStudentCode ?? '');
    // A returning student who set a PIN signs in with it by default.
    _usePin = app.lastHasPin && app.lastStudentCode != null;
  }

  @override
  void dispose() {
    _code.dispose();
    _secret.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await AppScope.read(context).signIn(studentCode: _code.text, secret: _secret.text, usePin: _usePin);
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = friendlyError(e));
      _secret.clear();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final t = Theme.of(context).textTheme;
    final returning = app.lastStudentName != null && _code.text == app.lastStudentCode;
    return AuthFrame(
      title: returning ? 'Welcome back, ${app.lastStudentName!.split(' ').first}' : 'Sign in',
      subtitle: 'Manchester Technologies',
      children: [
        if (app.notice != null && _error == null)
          Container(
            margin: const EdgeInsets.only(bottom: 16),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: Palette.marigoldSoft, borderRadius: BorderRadius.circular(8)),
            child: Text(app.notice!),
          ),
        ErrorText(_error),
        Form(
          key: _form,
          child: AutofillGroup(
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              TextFormField(
                key: const Key('studentCode'),
                controller: _code,
                decoration: const InputDecoration(labelText: 'Student ID', hintText: 'As printed on your ID card'),
                textCapitalization: TextCapitalization.characters,
                autocorrect: false,
                autofillHints: const [AutofillHints.username],
                textInputAction: TextInputAction.next,
                validator: (v) => (v == null || v.trim().isEmpty) ? 'Enter your student ID' : null,
              ),
              const SizedBox(height: 14),
              TextFormField(
                key: const Key('secret'),
                controller: _secret,
                obscureText: _obscure,
                keyboardType: _usePin ? TextInputType.number : TextInputType.visiblePassword,
                inputFormatters: _usePin ? [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(6)] : null,
                autofillHints: _usePin ? null : const [AutofillHints.password],
                decoration: InputDecoration(
                  labelText: _usePin ? 'PIN' : 'Password',
                  suffixIcon: IconButton(
                    tooltip: _obscure ? 'Show' : 'Hide',
                    icon: Icon(_obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined),
                    onPressed: () => setState(() => _obscure = !_obscure),
                  ),
                ),
                validator: (v) {
                  if (v == null || v.isEmpty) return _usePin ? 'Enter your PIN' : 'Enter your password';
                  if (_usePin && !pinRule.hasMatch(v)) return 'Your PIN is 4 to 6 digits';
                  return null;
                },
                onFieldSubmitted: (_) => _submit(),
              ),
              const SizedBox(height: 8),
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton(
                  onPressed: _busy
                      ? null
                      : () => setState(() {
                            _usePin = !_usePin;
                            _secret.clear();
                            _error = null;
                          }),
                  child: Text(_usePin ? 'Use password instead' : 'Use PIN instead'),
                ),
              ),
              const SizedBox(height: 12),
              FilledButton(
                key: const Key('signIn'),
                onPressed: _busy ? null : _submit,
                child: _busy
                    ? const SizedBox(height: 22, width: 22, child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white))
                    : const Text('Sign in'),
              ),
            ]),
          ),
        ),
        const SizedBox(height: 18),
        Text(
          'Forgot your password? Ask the college office to reset it.',
          textAlign: TextAlign.center,
          style: t.bodySmall?.copyWith(color: Palette.ink2),
        ),
        if (app.tabletSerial != null) ...[
          const SizedBox(height: 6),
          // Staff: press and hold the tablet number to open the staff panel (asks for the staff PIN).
          GestureDetector(
            key: const Key('tabletLabel'),
            onLongPress: () => openAdminPanel(context),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: Text('Tablet ${app.tabletSerial}', textAlign: TextAlign.center, style: t.bodySmall?.copyWith(color: Palette.ink2)),
            ),
          ),
        ],
      ],
    );
  }
}
