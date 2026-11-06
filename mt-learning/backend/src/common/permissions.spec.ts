import { canManageRole, Permission, roleHas, ROLE_PERMISSIONS } from './permissions';
import { temporaryPassword, PASSWORD_RULE } from './utils/secrets';
import { sniffImage } from './utils/storage.service';
import { likePattern } from './dto/pagination.dto';

describe('permissions', () => {
  it('gives administrators every permission', () => {
    for (const p of Object.values(Permission)) {
      expect(roleHas('SUPER_ADMIN', p)).toBe(true);
      expect(roleHas('COLLEGE_ADMIN', p)).toBe(true);
    }
  });

  it('keeps teachers read-only and away from credentials, devices and audit', () => {
    expect(roleHas('TEACHER', Permission.StudentsRead)).toBe(true);
    expect(roleHas('TEACHER', Permission.StudentsWrite)).toBe(false);
    expect(roleHas('TEACHER', Permission.StudentsCredentials)).toBe(false);
    expect(roleHas('TEACHER', Permission.StudentsSensitiveRead)).toBe(false);
    expect(roleHas('TEACHER', Permission.TabletsRead)).toBe(false);
    expect(roleHas('TEACHER', Permission.AuditRead)).toBe(false);
  });

  it('limits device administrators to tablets', () => {
    expect(roleHas('DEVICE_ADMIN', Permission.TabletsWrite)).toBe(true);
    expect(roleHas('DEVICE_ADMIN', Permission.StudentsWrite)).toBe(false);
    expect(roleHas('DEVICE_ADMIN', Permission.StaffRead)).toBe(false);
  });

  it('only a Super Administrator manages Super Administrators', () => {
    expect(canManageRole('SUPER_ADMIN', 'SUPER_ADMIN')).toBe(true);
    expect(canManageRole('COLLEGE_ADMIN', 'SUPER_ADMIN')).toBe(false);
    expect(canManageRole('COLLEGE_ADMIN', 'TEACHER')).toBe(true);
    expect(canManageRole('PRINCIPAL', 'TEACHER')).toBe(false);
  });

  it('defines permissions for every role', () => {
    expect(Object.keys(ROLE_PERMISSIONS)).toHaveLength(7);
  });
});

describe('secrets', () => {
  it('generates temporary passwords that satisfy the password rule and avoid look-alike characters', () => {
    for (let i = 0; i < 200; i++) {
      const pw = temporaryPassword();
      expect(pw).toMatch(PASSWORD_RULE);
      expect(pw).not.toMatch(/[0O1lI]/);
    }
  });
});

describe('sniffImage', () => {
  it('recognises images by content, not by name', () => {
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpg');
    expect(sniffImage(Buffer.from('89504e470d0a1a0a00', 'hex'))).toBe('png');
    expect(sniffImage(Buffer.from('RIFF0000WEBPVP8 '))).toBe('webp');
    expect(sniffImage(Buffer.from('<svg onload=alert(1)>'))).toBeNull();
  });
});

describe('likePattern', () => {
  it('escapes LIKE wildcards in search text', () => {
    expect(likePattern(' 50%_off ')).toBe('%50\\%\\_off%');
  });
});

import { grade, testState } from '../tests/tests.service';
import { CollegeClock } from './scope.service';

describe('grade', () => {
  const q = (id: string, correctIndex: number, marks = 1) =>
    ({ id, testId: 't', position: 1, text: '', options: ['a', 'b', 'c'], correctIndex, marks, topic: null, explanation: null }) as never;
  it('adds marks for right answers, deducts for wrong ones and ignores skips', () => {
    const qs = [q('a', 0), q('b', 1, 2), q('c', 2), q('d', 0)];
    expect(grade(qs, { a: 0, b: 1, c: 0, d: null }, 0.25)).toEqual({ score: 2.75, maxScore: 5, correctCount: 2 });
    expect(grade(qs, {}, 1)).toEqual({ score: 0, maxScore: 5, correctCount: 0 });
  });
});

describe('testState', () => {
  const now = new Date('2026-11-05T10:00:00Z');
  const t = (o: number, c: number, published = true) => ({ publishedAt: published ? now : null, opensAt: new Date(now.getTime() + o), closesAt: new Date(now.getTime() + c) });
  it('derives draft, upcoming, open and closed', () => {
    expect(testState(t(-1, 1, false), now)).toBe('draft');
    expect(testState(t(1, 2), now)).toBe('upcoming');
    expect(testState(t(-1, 1), now)).toBe('open');
    expect(testState(t(-2, -1), now)).toBe('closed');
  });
});

describe('CollegeClock', () => {
  it('uses the college time zone, not the server’s', () => {
    const c = new CollegeClock('Asia/Kolkata');
    const lateUtc = new Date('2026-11-05T20:00:00Z'); // 01:30 on 6 Nov in India
    expect(c.today(lateUtc)).toBe('2026-11-06');
    expect(c.timeOfDay(lateUtc)).toBe('01:30');
    expect(c.dayOfWeek(lateUtc)).toBe(5); // Friday
    expect(CollegeClock.addDays('2026-02-28', 1)).toBe('2026-03-01');
  });
});

import { poolConfig, sslMode } from '../db/pg-config';

describe('database SSL settings', () => {
  const saved = process.env.DATABASE_SSL;
  afterEach(() => {
    if (saved === undefined) delete process.env.DATABASE_SSL;
    else process.env.DATABASE_SSL = saved;
  });

  it('is off for a local database', () => {
    delete process.env.DATABASE_SSL;
    expect(sslMode('postgresql://mt:mt@localhost:5432/mt')).toBe('off');
    expect(sslMode('postgresql://mt:mt@db:5432/mt')).toBe('off');
    expect(poolConfig('postgresql://mt:mt@localhost:5432/mt', 3).ssl).toBeUndefined();
  });

  it('is on for Supabase, and the URL sslmode does not override it', () => {
    delete process.env.DATABASE_SSL;
    const url = 'postgresql://postgres.abc:p%40ss@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require';
    const c = poolConfig(url, 3);
    expect(c.ssl).toEqual({ rejectUnauthorized: false });
    expect(c.connectionString).not.toContain('sslmode');
    expect(c.connectionString).toContain('p%40ss');
  });

  it('follows DATABASE_SSL when set', () => {
    process.env.DATABASE_SSL = 'off';
    expect(sslMode('postgresql://u:p@x.supabase.com/db')).toBe('off');
    process.env.DATABASE_SSL = 'verify';
    expect(poolConfig('postgresql://u:p@x.supabase.com/db', 1).ssl).toEqual({ rejectUnauthorized: true });
  });
});
