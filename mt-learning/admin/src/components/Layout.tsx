import { useIsFetching, useIsMutating, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { DashboardSummary } from '../api/types';
import { P, useAuth } from '../auth/AuthContext';
import { ROLE_LABEL } from '../lib/format';
import { Icon, type IconName } from './icons';

type Item = { to: string; label: string; perm: string; icon: IconName };

const NAV: { group?: string; items: Item[] }[] = [
  { items: [{ to: '/', label: 'Dashboard', perm: P.DashboardView, icon: 'home' }] },
  {
    group: 'College',
    items: [
      { to: '/students', label: 'Students', perm: P.StudentsRead, icon: 'people' },
      { to: '/classes', label: 'Classes & sections', perm: P.AcademicRead, icon: 'layers' },
    ],
  },
  {
    group: 'Exams',
    items: [
      { to: '/tests', label: 'Live tests', perm: P.TestsRead, icon: 'test' },
      { to: '/results', label: 'Results & marks', perm: P.TestsReview, icon: 'chart' },
    ],
  },
  {
    group: 'Admin',
    items: [
      { to: '/tablets', label: 'Tablets', perm: P.TabletsRead, icon: 'tablet' },
      { to: '/staff', label: 'Staff', perm: P.StaffRead, icon: 'key' },
      { to: '/audit', label: 'Audit log', perm: P.AuditRead, icon: 'shield' },
    ],
  },
];

export function Layout() {
  const { me, can, logout } = useAuth();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const busy = useIsFetching() + useIsMutating() > 0;

  const summary = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api<DashboardSummary>('/dashboard/summary'),
    enabled: can(P.DashboardView),
    staleTime: 60_000,
  });
  const badges: Record<string, number> = {
    '/tablets': summary.data?.tablets.staleAssigned ?? 0,
    '/results': summary.data?.tests?.pendingReviews ?? 0,
  };

  useEffect(() => setOpen(false), [pathname]);

  const initials = (me?.fullName ?? '?')
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className={`app${open ? ' nav-open' : ''}`}>
      <a href="#main" className="skip">
        Skip to content
      </a>
      <div className={`progress${busy ? ' on' : ''}`} aria-hidden="true" />

      <aside className="side">
        <NavLink to="/" className="side-brand" aria-label="MT Learning, dashboard">
          <span className="side-logo">MT</span>
          <span>
            <strong>MT Learning</strong>
            <em>Manchester Technologies</em>
          </span>
        </NavLink>

        <nav className="side-nav" aria-label="Main">
          {NAV.map((g, gi) => {
            const items = g.items.filter((i) => can(i.perm));
            if (!items.length) return null;
            return (
              <div key={g.group ?? gi} className="side-group">
                {g.group && <p>{g.group}</p>}
                {items.map((i) => (
                  <NavLink key={i.to} to={i.to} end={i.to === '/'}>
                    <Icon name={i.icon} />
                    <span>{i.label}</span>
                    {(badges[i.to] ?? 0) > 0 && <b className="side-count">{badges[i.to]}</b>}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>

        {summary.data?.academicYear && (
          <div className="side-year">
            <span>Academic year</span>
            <strong>{summary.data.academicYear.name}</strong>
          </div>
        )}
      </aside>

      <header className="mobile-bar">
        <button className="mobile-menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <Icon name={open ? 'x' : 'menu'} />
          <span className="sr-only">Menu</span>
        </button>
        <span className="side-logo">MT</span>
        <strong>MT Learning</strong>
      </header>
      {open && <button className="scrim" aria-label="Close menu" onClick={() => setOpen(false)} />}

      <div className="shell">
        <header className="topbar">
          {can(P.StudentsRead) && (
            <form
              className="topbar-search"
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                const q = query.trim();
                navigate(q ? `/students?search=${encodeURIComponent(q)}` : '/students');
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="M20 20l-3.5-3.5" />
              </svg>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search students by name or ID"
                aria-label="Search students"
              />
            </form>
          )}
          <span className="topbar-space" />
          <NavLink to="/account" className="topbar-user">
            <span className="side-avatar">{initials}</span>
            <span>
              <strong>{me?.fullName}</strong>
              <span>{me && ROLE_LABEL[me.role]}</span>
            </span>
          </NavLink>
          <button className="topbar-out" onClick={() => void logout()} aria-label="Sign out" title="Sign out">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
              <path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11" />
            </svg>
          </button>
        </header>
        <main id="main" className="main" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
