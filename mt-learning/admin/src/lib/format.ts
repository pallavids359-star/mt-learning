import type { AccountStatus, StaffRole, TabletStatus } from '../api/types';

export const ROLE_LABEL: Record<StaffRole, string> = {
  SUPER_ADMIN: 'Super Administrator',
  COLLEGE_ADMIN: 'College Administrator',
  PRINCIPAL: 'Principal / Academic Head',
  TEACHER: 'Teacher',
  EXAM_COORDINATOR: 'Examination Coordinator',
  HOSTEL_WARDEN: 'Hostel Warden',
  DEVICE_ADMIN: 'Technical / Device Administrator',
};

export const STATUS_LABEL: Record<AccountStatus, string> = {
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
  DEACTIVATED: 'Deactivated',
};

export const TABLET_LABEL: Record<TabletStatus, string> = {
  IN_STOCK: 'In stock',
  ASSIGNED: 'Assigned',
  UNDER_REPAIR: 'Under repair',
  LOST: 'Lost',
  RETIRED: 'Retired',
};

export const PUC_LABEL = { PUC_1: '1st PUC', PUC_2: '2nd PUC' } as const;

const dt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const d = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export const fmtDateTime = (v: string | null | undefined) => (v ? dt.format(new Date(v)) : '—');
export const fmtDate = (v: string | null | undefined) => (v ? d.format(new Date(v)) : '—');

export function fmtAgo(v: string | null | undefined): string {
  if (!v) return 'Never';
  const s = Math.round((Date.now() - new Date(v).getTime()) / 1000);
  if (s < 60) return 'Just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.round(h / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return fmtDate(v);
}

const ACTION_LABEL: Record<string, string> = {
  'auth.staff.login': 'Staff signed in',
  'auth.staff.login_failed': 'Failed staff sign-in',
  'auth.staff.password_changed': 'Staff changed own password',
  'auth.student.login': 'Student signed in',
  'auth.student.login_failed': 'Failed student sign-in',
  'auth.student.wrong_device': 'Student tried another tablet',
  'auth.student.password_changed': 'Student changed own password',
  'auth.student.pin_set': 'Student set a PIN',
  'auth.refresh_reuse_detected': 'Suspicious session reuse blocked',
  'student.create': 'Student added',
  'student.update': 'Student details edited',
  'student.status': 'Student status changed',
  'student.transfer': 'Student transferred',
  'student.credentials_reset': 'Student password reset',
  'student.photo': 'Student photo updated',
  'student.import': 'Students imported',
  'staff.create': 'Staff account created',
  'staff.update': 'Staff account edited',
  'staff.status': 'Staff status changed',
  'staff.password_reset': 'Staff password reset',
  'tablet.enroll': 'Tablet enrolled',
  'tablet.update': 'Tablet edited',
  'tablet.assign': 'Tablet assigned',
  'tablet.unassign': 'Tablet unassigned',
  'tablet.status': 'Tablet status changed',
};

/** Human label for an audit action; falls back to "student.credentials_reset" → "Student credentials reset". */
export function fmtAction(a: string): string {
  if (ACTION_LABEL[a]) return ACTION_LABEL[a];
  const s = a.replace(/[._]/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const fmtBytes = (n: number | null | undefined) => {
  if (!n) return '';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
};

const tShort = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
export const fmtWhen = (v: string | null | undefined) => (v ? tShort.format(new Date(v)) : '—');

export const fmtDuration = (sec: number | null | undefined) => {
  if (sec === null || sec === undefined) return '—';
  const m = Math.floor(sec / 60);
  return `${m}:${String(sec % 60).padStart(2, '0')}`;
};

Object.assign(ACTION_LABEL, {
  'material.create': 'Material added',
  'material.update': 'Material edited',
  'material.file': 'Material file uploaded',
  'material.publish': 'Material published',
  'material.unpublish': 'Material withdrawn',
  'material.delete': 'Material deleted',
  'test.create': 'Test created',
  'test.update': 'Test edited',
  'test.questions': 'Test questions saved',
  'test.publish': 'Test published',
  'test.unpublish': 'Test withdrawn',
  'test.delete': 'Test deleted',
  'test.submit': 'Test submitted',
  'test.package_download': 'Offline test downloaded',
  'test.review': 'Late submission reviewed',
  'test.force_submit': 'Test submitted by staff',
  'test.revive': 'Test revived (student continues)',
  'test.restart': 'Test restarted for a student',
  'test.release_results': 'Results released',
  'attendance.take': 'Attendance taken',
  'attendance.update': 'Attendance updated',
  'attendance.correct': 'Attendance corrected',
  'notice.create': 'Notice posted',
  'notice.delete': 'Notice withdrawn',
  'live.create': 'Live class scheduled',
  'live.update': 'Live class edited',
  'live.cancel': 'Live class cancelled',
  'timetable.update': 'Timetable updated',
  'class.teachers': 'Teachers assigned',
  'holiday.create': 'Holiday added',
  'holiday.delete': 'Holiday removed',
  'tablet.remote_wipe': 'Lost tablet signed out and wiped',
});
