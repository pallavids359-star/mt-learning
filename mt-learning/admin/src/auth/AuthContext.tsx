import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ensureSession, hasStoredSession, logout as apiLogout, setSessionLostHandler, setTokens } from '../api/client';
import type { Me } from '../api/types';

export const P = {
  DashboardView: 'dashboard.view',
  AcademicRead: 'academic.read',
  AcademicWrite: 'academic.write',
  StudentsRead: 'students.read',
  StudentsWrite: 'students.write',
  StudentsCredentials: 'students.credentials',
  HostelsRead: 'hostels.read',
  HostelsWrite: 'hostels.write',
  TabletsRead: 'tablets.read',
  TabletsWrite: 'tablets.write',
  StaffRead: 'staff.read',
  StaffWrite: 'staff.write',
  AuditRead: 'audit.read',
  MaterialsRead: 'materials.read',
  MaterialsWrite: 'materials.write',
  TestsRead: 'tests.read',
  TestsWrite: 'tests.write',
  TestsReview: 'tests.review',
  AttendanceRead: 'attendance.read',
  AttendanceWrite: 'attendance.write',
  AttendanceCorrect: 'attendance.correct',
  NoticesRead: 'notices.read',
  NoticesWrite: 'notices.write',
  LiveRead: 'live.read',
  LiveWrite: 'live.write',
} as const;

interface AuthState {
  me: Me | null;
  loading: boolean;
  can: (permission: string) => boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setMe(await api<Me>('/auth/me'));
  }, []);

  useEffect(() => {
    setSessionLostHandler(() => {
      setTokens(null);
      setMe(null);
      qc.clear();
    });
    (async () => {
      try {
        if (hasStoredSession() && (await ensureSession())) await reload();
      } catch {
        setTokens(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [qc, reload]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api<{ accessToken: string; refreshToken: string }>('/auth/staff/login', {
        method: 'POST',
        body: { email, password },
      });
      setTokens(res);
      await reload();
    },
    [reload],
  );

  const logout = useCallback(async () => {
    await apiLogout();
    setMe(null);
    qc.clear();
  }, [qc]);

  const value = useMemo<AuthState>(
    () => ({ me, loading, can: (p) => !!me?.permissions.includes(p), login, logout, reload }),
    [me, loading, login, logout, reload],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside AuthProvider');
  return v;
}
