import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/app_scope.dart';
import '../../core/app_state.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import '../prep/analytics_page.dart';
import '../prep/mock_page.dart';
import '../prep/practice_page.dart';
import '../prep/prep_home_page.dart';
import '../prep/revise_page.dart';
import '../profile/profile_page.dart';
import '../tests/tests_page.dart';

enum ShellTab {
  home('Home', Icons.home_outlined, Icons.home),
  practice('Practice', Icons.edit_note_outlined, Icons.edit_note),
  mock('Mock tests', Icons.timer_outlined, Icons.timer),
  live('Live tests', Icons.campaign_outlined, Icons.campaign),
  revise('Revise', Icons.replay_outlined, Icons.replay),
  analytics('Analytics', Icons.insights_outlined, Icons.insights),
  profile('Profile', Icons.person_outline, Icons.person);

  const ShellTab(this.label, this.icon, this.selectedIcon);
  final String label;
  final IconData icon;
  final IconData selectedIcon;
}

/// Signed-in frame: a white side menu on tablets, a bottom bar on phones,
/// a top bar with sync status, and a band when the tablet is offline.
class AppShell extends StatefulWidget {
  const AppShell({super.key});

  /// Lets any page switch tabs, e.g. "See all" on the home page.
  static void go(BuildContext context, ShellTab tab) => context.findAncestorStateOfType<_AppShellState>()?.go(tab);

  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> with WidgetsBindingObserver {
  ShellTab _tab = ShellTab.home;
  Timer? _autoSync;

  void go(ShellTab tab) => setState(() => _tab = tab);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    // Keep data fresh while the app is open; sync() is a no-op if one is already running.
    _autoSync = Timer.periodic(const Duration(minutes: 5), (_) => AppScope.read(context).sync());
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    if (s == AppLifecycleState.resumed) AppScope.read(context).sync();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _autoSync?.cancel();
    super.dispose();
  }

  Widget _page() => switch (_tab) {
        ShellTab.home => const PrepHomePage(),
        ShellTab.practice => const PracticePage(),
        ShellTab.mock => const MockPage(),
        ShellTab.live => const TestsPage(),
        ShellTab.revise => const RevisePage(),
        ShellTab.analytics => const AnalyticsPage(),
        ShellTab.profile => const ProfilePage(),
      };

  int _badge(AppState app, ShellTab t) => switch (t) {
        ShellTab.live => app.testList.where((x) => x.canStart).length,
        _ => 0,
      };

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final wide = MediaQuery.sizeOf(context).width >= 760;
    final body = Column(children: [
      _TopBar(tab: _tab, onProfile: () => go(ShellTab.profile)),
      if (app.syncStatus == SyncStatus.offline) const _OfflineBand(),
      Expanded(
        child: AnimatedSwitcher(
          duration: const Duration(milliseconds: 160),
          child: KeyedSubtree(key: ValueKey(_tab), child: _page()),
        ),
      ),
    ]);

    if (wide) {
      return Scaffold(
        body: Row(children: [
          _Rail(current: _tab, onSelect: go, badge: (t) => _badge(app, t)),
          Expanded(child: body),
        ]),
      );
    }
    const primary = [ShellTab.home, ShellTab.practice, ShellTab.mock, ShellTab.live];
    final inPrimary = primary.contains(_tab);
    return Scaffold(
      body: SafeArea(bottom: false, child: body),
      bottomNavigationBar: NavigationBar(
        selectedIndex: inPrimary ? primary.indexOf(_tab) : primary.length,
        onDestinationSelected: (i) {
          if (i < primary.length) {
            go(primary[i]);
          } else {
            _more(context, app);
          }
        },
        destinations: [
          for (final t in primary)
            NavigationDestination(
              icon: Badge(isLabelVisible: _badge(app, t) > 0, label: Text('${_badge(app, t)}'), child: Icon(t.icon)),
              selectedIcon: Icon(t.selectedIcon),
              label: t.label,
            ),
          const NavigationDestination(icon: Icon(Icons.more_horiz), label: 'More'),
        ],
      ),
    );
  }

  void _more(BuildContext context, AppState app) {
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (ctx) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          for (final t in [ShellTab.revise, ShellTab.analytics, ShellTab.profile])
            ListTile(
              leading: Icon(t.icon),
              title: Text(t.label),
                            onTap: () {
                Navigator.pop(ctx);
                go(t);
              },
            ),
        ]),
      ),
    );
  }
}

class _Rail extends StatelessWidget {
  const _Rail({required this.current, required this.onSelect, required this.badge});
  final ShellTab current;
  final ValueChanged<ShellTab> onSelect;
  final int Function(ShellTab) badge;

  @override
  Widget build(BuildContext context) {
    // Labels beside the icons on big tablets; icons with small labels on smaller ones.
    final wide = MediaQuery.sizeOf(context).width >= 1000;
    return Container(
      width: wide ? 210 : 96,
      decoration: const BoxDecoration(color: Palette.surface, border: Border(right: BorderSide(color: Palette.line))),
      child: SafeArea(
        right: false,
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Padding(
            padding: EdgeInsets.fromLTRB(wide ? 20 : 0, 20, wide ? 12 : 0, 20),
            child: wide
                ? const Row(children: [
                    BrandMark(size: 36),
                    SizedBox(width: 10),
                    Text('MT Learning', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 16)),
                  ])
                : const Center(child: BrandMark(size: 40)),
          ),
          Expanded(
            child: ListView(padding: const EdgeInsets.symmetric(horizontal: 12), children: [
              for (final t in ShellTab.values)
                if (t != ShellTab.profile) _RailItem(tab: t, wide: wide, selected: t == current, badge: badge(t), onTap: () => onSelect(t)),
            ]),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: _RailItem(tab: ShellTab.profile, wide: wide, selected: current == ShellTab.profile, badge: 0, onTap: () => onSelect(ShellTab.profile)),
          ),
          const SizedBox(height: 12),
        ]),
      ),
    );
  }
}

class _RailItem extends StatelessWidget {
  const _RailItem({required this.tab, required this.wide, required this.selected, required this.badge, required this.onTap});
  final ShellTab tab;
  final bool wide;
  final bool selected;
  final int badge;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final fg = selected ? Palette.board : Palette.ink2;
    final icon = Badge(
      isLabelVisible: badge > 0,
      backgroundColor: Palette.warn,
      textColor: Colors.white,
      label: Text('$badge'),
      child: Icon(selected ? tab.selectedIcon : tab.icon, color: fg, size: 22),
    );
    final label = Text(
      tab.label,
      style: TextStyle(color: selected ? Palette.board : Palette.ink, fontSize: wide ? 15.5 : 11.5, fontWeight: selected ? FontWeight.w600 : FontWeight.w500),
      maxLines: 1,
      overflow: TextOverflow.fade,
      softWrap: false,
    );
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Semantics(
        selected: selected,
        button: true,
        label: tab.label,
        child: Material(
          color: selected ? Palette.boardSoft : Colors.transparent,
          borderRadius: BorderRadius.circular(10),
          child: InkWell(
            borderRadius: BorderRadius.circular(10),
            onTap: onTap,
            child: Padding(
              padding: wide ? const EdgeInsets.symmetric(horizontal: 12, vertical: 12) : const EdgeInsets.symmetric(vertical: 10),
              child: wide
                  ? Row(children: [icon, const SizedBox(width: 12), Expanded(child: label)])
                  : Column(children: [icon, const SizedBox(height: 4), label]),
            ),
          ),
        ),
      ),
    );
  }
}

class _TopBar extends StatelessWidget {
  const _TopBar({required this.tab, required this.onProfile});
  final ShellTab tab;
  final VoidCallback onProfile;

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final p = app.home?.profile;
    return Container(
      padding: EdgeInsets.fromLTRB(20, 10 + (MediaQuery.sizeOf(context).width >= 760 ? MediaQuery.paddingOf(context).top : 0), 16, 10),
      decoration: const BoxDecoration(color: Palette.surface, border: Border(bottom: BorderSide(color: Palette.line))),
      child: Row(children: [
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(tab.label, style: Theme.of(context).textTheme.titleLarge),
            if (p != null) Text('${p.pucLabel} · ${p.stream} · ${p.sectionName}', style: const TextStyle(color: Palette.ink2, fontSize: 13)),
          ]),
        ),
        _SyncPill(app: app),
        const SizedBox(width: 10),
        Semantics(
          button: true,
          label: 'Profile',
          child: InkWell(
            customBorder: const CircleBorder(),
            onTap: onProfile,
            child: CircleAvatar(
              radius: 20,
              backgroundColor: Palette.boardSoft,
              backgroundImage: app.photo != null ? MemoryImage(app.photo!) : null,
              child: app.photo == null
                  ? Text(initials(p?.fullName ?? app.lastStudentName ?? ''), style: const TextStyle(color: Palette.board, fontWeight: FontWeight.w600))
                  : null,
            ),
          ),
        ),
      ]),
    );
  }
}

class _SyncPill extends StatelessWidget {
  const _SyncPill({required this.app});
  final AppState app;

  @override
  Widget build(BuildContext context) {
    final pending = app.pendingUploads;
    final (label, tone, icon) = switch (app.syncStatus) {
      SyncStatus.syncing => ('Syncing…', PillTone.board, Icons.sync),
      SyncStatus.offline => (pending > 0 ? 'Offline · $pending to upload' : 'Offline', PillTone.warn, Icons.cloud_off),
      SyncStatus.failed => ('Sync failed', PillTone.bad, Icons.error_outline),
      _ => (
          app.lastSyncedAt == null ? 'Not synced' : 'Synced ${formatAgo(app.lastSyncedAt!)}',
          PillTone.ok,
          Icons.cloud_done_outlined,
        ),
    };
    return Tooltip(
      message: 'Tap to sync now',
      child: InkWell(
        borderRadius: BorderRadius.circular(4),
        onTap: app.syncStatus == SyncStatus.syncing ? null : () => app.sync(),
        child: Pill(label, tone: tone, icon: icon),
      ),
    );
  }
}

class _OfflineBand extends StatelessWidget {
  const _OfflineBand();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      color: Palette.warnSoft,
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
      child: const Text(
        'You are offline. Live tests you already opened still work and upload when Wi-Fi is back. Practice needs Wi-Fi.',
        style: TextStyle(color: Palette.warn, fontWeight: FontWeight.w600),
      ),
    );
  }
}

/// Standard scrolling page body with pull-to-refresh.
class PageBody extends StatelessWidget {
  const PageBody({super.key, required this.children, this.maxWidth = 1180});
  final List<Widget> children;
  final double maxWidth;

  @override
  Widget build(BuildContext context) {
    final app = AppScope.read(context);
    return RefreshIndicator(
      onRefresh: app.sync,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 20, 20, 32),
        children: [
          Center(
            child: ConstrainedBox(
              constraints: BoxConstraints(maxWidth: maxWidth),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children),
            ),
          ),
        ],
      ),
    );
  }
}
