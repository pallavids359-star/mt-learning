import type { StaffRole } from '../db/schema';

/**
 * Fine-grained permissions. Endpoints declare the permission they need; roles map to
 * permission sets below. Change the matrix here rather than sprinkling role checks in code.
 */
export const Permission = {
  DashboardView: 'dashboard.view',
  AcademicRead: 'academic.read',
  AcademicWrite: 'academic.write',
  StudentsRead: 'students.read',
  StudentsWrite: 'students.write',
  StudentsCredentials: 'students.credentials',
  StudentsSensitiveRead: 'students.sensitive.read', // guardian contact, DOB
  HostelsRead: 'hostels.read',
  HostelsWrite: 'hostels.write',
  TabletsRead: 'tablets.read',
  TabletsWrite: 'tablets.write',
  StaffRead: 'staff.read',
  StaffWrite: 'staff.write',
  AuditRead: 'audit.read',
  // Phase 2
  MaterialsRead: 'materials.read',
  MaterialsWrite: 'materials.write',
  TestsRead: 'tests.read',
  TestsWrite: 'tests.write',
  TestsReview: 'tests.review',
  AttendanceRead: 'attendance.read',
  AttendanceWrite: 'attendance.write',
  AttendanceCorrect: 'attendance.correct', // change a record after it was first saved
  NoticesRead: 'notices.read',
  NoticesWrite: 'notices.write',
  LiveRead: 'live.read',
  LiveWrite: 'live.write',
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];

const ALL = Object.values(Permission);

export const ROLE_PERMISSIONS: Record<StaffRole, readonly Permission[]> = {
  SUPER_ADMIN: ALL,
  COLLEGE_ADMIN: ALL,
  PRINCIPAL: [
    Permission.DashboardView,
    Permission.AcademicRead,
    Permission.StudentsRead,
    Permission.StudentsSensitiveRead,
    Permission.HostelsRead,
    Permission.TabletsRead,
    Permission.StaffRead,
    Permission.AuditRead,
    Permission.MaterialsRead,
    Permission.TestsRead,
    Permission.TestsReview,
    Permission.AttendanceRead,
    Permission.AttendanceCorrect,
    Permission.NoticesRead,
    Permission.NoticesWrite,
    Permission.LiveRead,
  ],
  // Teachers manage materials, tests and live classes only for the class/subject pairs they are assigned to.
  TEACHER: [
    Permission.DashboardView,
    Permission.AcademicRead,
    Permission.StudentsRead,
    Permission.MaterialsRead,
    Permission.MaterialsWrite,
    Permission.TestsRead,
    Permission.TestsWrite,
    Permission.TestsReview,
    Permission.AttendanceRead,
    Permission.AttendanceWrite,
    Permission.NoticesRead,
    Permission.NoticesWrite,
    Permission.LiveRead,
    Permission.LiveWrite,
  ],
  EXAM_COORDINATOR: [
    Permission.DashboardView,
    Permission.AcademicRead,
    Permission.StudentsRead,
    Permission.MaterialsRead,
    Permission.TestsRead,
    Permission.TestsWrite,
    Permission.TestsReview,
    Permission.AttendanceRead,
    Permission.NoticesRead,
    Permission.NoticesWrite,
    Permission.LiveRead,
  ],
  // Wardens take hostel roll calls for the hostels they are warden of.
  HOSTEL_WARDEN: [
    Permission.DashboardView,
    Permission.AcademicRead,
    Permission.StudentsRead,
    Permission.StudentsSensitiveRead,
    Permission.HostelsRead,
    Permission.HostelsWrite,
    Permission.AttendanceRead,
    Permission.AttendanceWrite,
    Permission.NoticesRead,
    Permission.NoticesWrite,
  ],
  DEVICE_ADMIN: [
    Permission.DashboardView,
    Permission.AcademicRead,
    Permission.StudentsRead,
    Permission.TabletsRead,
    Permission.TabletsWrite,
  ],
};

export function roleHas(role: StaffRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** Roles a given role may create or manage. Only a Super Administrator can manage Super Administrators. */
export function canManageRole(actor: StaffRole, target: StaffRole): boolean {
  if (actor === 'SUPER_ADMIN') return true;
  if (actor === 'COLLEGE_ADMIN') return target !== 'SUPER_ADMIN';
  return false;
}
