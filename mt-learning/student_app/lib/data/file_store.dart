import 'dart:io';

import 'package:path_provider/path_provider.dart';

/// Downloaded study materials, kept in the app's private storage. Other apps cannot read
/// this folder, Android encrypts it at rest, and app-data backup is disabled in the manifest.
class FileStore {
  Directory? _dir;

  Future<Directory> _root() async {
    if (_dir != null) return _dir!;
    final base = await getApplicationSupportDirectory();
    final dir = Directory('${base.path}/materials');
    if (!await dir.exists()) await dir.create(recursive: true);
    return _dir = dir;
  }

  Future<File> fileFor(String materialId, String ext) async => File('${(await _root()).path}/$materialId.$ext');

  /// Material ids that are fully downloaded.
  Future<Set<String>> downloadedIds() async {
    final dir = await _root();
    final out = <String>{};
    await for (final e in dir.list()) {
      if (e is File && !e.path.endsWith('.part')) {
        final name = e.uri.pathSegments.last;
        out.add(name.substring(0, name.lastIndexOf('.')));
      }
    }
    return out;
  }

  Future<File?> existing(String materialId, String ext) async {
    final f = await fileFor(materialId, ext);
    return await f.exists() ? f : null;
  }

  Future<void> remove(String materialId, String ext) async {
    final f = await fileFor(materialId, ext);
    if (await f.exists()) await f.delete();
  }

  /// Removes every downloaded file (sign-out or remote wipe).
  Future<void> wipe() async {
    final dir = await _root();
    if (await dir.exists()) await dir.delete(recursive: true);
    _dir = null;
  }

  Future<int> totalBytes() async {
    final dir = await _root();
    var total = 0;
    await for (final e in dir.list()) {
      if (e is File) total += await e.length();
    }
    return total;
  }
}
