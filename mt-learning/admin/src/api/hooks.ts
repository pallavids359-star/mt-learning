import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import type { AcademicYear, ClassGroup, Hostel, Page, Staff, Subject } from './types';

export const useYears = () => useQuery({ queryKey: ['years'], queryFn: () => api<AcademicYear[]>('/academic-years') });

export const useClasses = (academicYearId?: string) =>
  useQuery({
    queryKey: ['classes', academicYearId ?? 'current'],
    queryFn: () => api<ClassGroup[]>('/classes', { query: { academicYearId } }),
  });

export const useSubjects = () => useQuery({ queryKey: ['subjects'], queryFn: () => api<Subject[]>('/subjects') });

export const useHostels = () => useQuery({ queryKey: ['hostels'], queryFn: () => api<Hostel[]>('/hostels') });

/** Flattens classes into "Class · Section" options for selects. */
export function sectionOptions(classes: ClassGroup[] | undefined) {
  return (classes ?? []).flatMap((c) => c.sections.map((s) => ({ id: s.id, classId: c.id, label: `${c.name} — ${s.name}` })));
}


/** Active teachers, for pickers. */
export const useTeachers = () =>
  useQuery({
    queryKey: ['staff', 'teachers'],
    queryFn: () => api<Page<Staff>>('/staff', { query: { role: 'TEACHER', status: 'ACTIVE', pageSize: 200 } }),
    retry: false,
  });

/** Today's date (YYYY-MM-DD) in the browser's time zone, for date inputs. */
export const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Converts a value from <input type="datetime-local"> to ISO (UTC). */
export const localInputToIso = (v: string) => new Date(v).toISOString();

/** Converts an ISO time to the value format of <input type="datetime-local">. */
export const isoToLocalInput = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** For teachers: the class/subject pairs they teach (null for other roles = everything allowed). */
export const useMyTeaching = () =>
  useQuery({
    queryKey: ['teaching', 'mine'],
    queryFn: () => api<{ restricted: boolean; pairs: { classId: string; subjectId: string }[] }>('/teaching/mine'),
    staleTime: 300_000,
  });
