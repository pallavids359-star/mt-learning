import { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import request from 'supertest';
import { ADMIN, bearer, setupApp, staffToken } from './helpers';

const API = '/api/v1';

let app: INestApplication;
let http: ReturnType<typeof request>;
let pool: Pool;
let admin: string;

// Shared fixtures created along the way
let yearId: string;
let classId: string;
let sectionA: string;
let sectionB: string;
let hostelId: string;
let studentId: string;
let studentPassword: string;
let tabletId: string;

beforeAll(async () => {
  ({ app, http, pool } = await setupApp());
  admin = await staffToken(http);
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe('health', () => {
  it('reports ready when the database is up', async () => {
    await http.get('/health/ready').expect(200, { status: 'ok', database: 'up' });
  });
});

describe('staff authentication', () => {
  it('rejects a wrong password without revealing whether the account exists', async () => {
    const a = await http.post(`${API}/auth/staff/login`).send({ email: ADMIN.email, password: 'nope-nope-1' }).expect(401);
    const b = await http.post(`${API}/auth/staff/login`).send({ email: 'ghost@test.local', password: 'nope-nope-1' }).expect(401);
    expect(a.body.message).toBe(b.body.message);
  });

  it('requires a token on private endpoints', async () => {
    await http.get(`${API}/students`).expect(401);
    await http.get(`${API}/students`).set(bearer('not-a-jwt')).expect(401);
  });

  it('rejects unknown body fields', async () => {
    await http.post(`${API}/auth/staff/login`).send({ email: ADMIN.email, password: 'x', role: 'SUPER_ADMIN' }).expect(400);
  });

  it('rotates refresh tokens and revokes the whole session on reuse', async () => {
    const login = await http.post(`${API}/auth/staff/login`).send(ADMIN).expect(200);
    const r1 = login.body.refreshToken;
    const second = await http.post(`${API}/auth/refresh`).send({ refreshToken: r1 }).expect(200);
    const r2 = second.body.refreshToken;
    expect(r2).not.toBe(r1);
    // Replaying the old token is treated as theft…
    await http.post(`${API}/auth/refresh`).send({ refreshToken: r1 }).expect(401);
    // …and the newer token in the same session stops working too.
    await http.post(`${API}/auth/refresh`).send({ refreshToken: r2 }).expect(401);
    const audit = await pool.query(`select 1 from audit_logs where action = 'auth.refresh_reuse_detected'`);
    expect(audit.rowCount).toBeGreaterThan(0);
  });

  it('limits repeated sign-in attempts per account, not for the whole network', async () => {
    for (let i = 0; i < 15; i++) {
      await http.post(`${API}/auth/staff/login`).send({ email: 'flood@test.local', password: 'x-wrong-1' }).expect(401);
    }
    await http.post(`${API}/auth/staff/login`).send({ email: 'flood@test.local', password: 'x-wrong-1' }).expect(429);
    // Another account from the same address (e.g. the same hostel Wi-Fi) is unaffected.
    await http.post(`${API}/auth/staff/login`).send({ email: 'other@test.local', password: 'x-wrong-1' }).expect(401);
  });

  it('logout revokes the refresh token', async () => {
    const login = await http.post(`${API}/auth/staff/login`).send(ADMIN).expect(200);
    await http.post(`${API}/auth/logout`).send({ refreshToken: login.body.refreshToken }).expect(204);
    await http.post(`${API}/auth/refresh`).send({ refreshToken: login.body.refreshToken }).expect(401);
  });
});

describe('academic structure', () => {
  it('creates an academic year and only one can be current', async () => {
    const y = await http
      .post(`${API}/academic-years`)
      .set(bearer(admin))
      .send({ name: '2026-27', startDate: '2026-06-01', endDate: '2027-03-31', isCurrent: true })
      .expect(201);
    yearId = y.body.id;
    const y2 = await http
      .post(`${API}/academic-years`)
      .set(bearer(admin))
      .send({ name: '2027-28', startDate: '2027-06-01', endDate: '2028-03-31', isCurrent: true })
      .expect(201);
    const list = await http.get(`${API}/academic-years`).set(bearer(admin)).expect(200);
    expect(list.body.filter((x: { isCurrent: boolean }) => x.isCurrent)).toHaveLength(1);
    await http.post(`${API}/academic-years/${yearId}/set-current`).set(bearer(admin)).expect(200);
    expect(y2.body.id).toBeDefined();
  });

  it('rejects an end date before the start date', async () => {
    await http
      .post(`${API}/academic-years`)
      .set(bearer(admin))
      .send({ name: '2030-31', startDate: '2030-06-01', endDate: '2030-01-01' })
      .expect(400);
  });

  it('creates subjects, a class with sections and subjects, and a hostel', async () => {
    const codes = ['PHY', 'CHE', 'MAT', 'BIO'];
    const ids: string[] = [];
    for (const code of codes) {
      const r = await http.post(`${API}/subjects`).set(bearer(admin)).send({ code: code.toLowerCase(), name: code }).expect(201);
      expect(r.body.code).toBe(code);
      ids.push(r.body.id);
    }
    await http.post(`${API}/subjects`).set(bearer(admin)).send({ code: 'PHY', name: 'Dup' }).expect(409);

    const c = await http
      .post(`${API}/classes`)
      .set(bearer(admin))
      .send({ academicYearId: yearId, pucYear: 'PUC_1', stream: 'PCMB', name: '1st PUC PCMB', sectionNames: ['A', 'B'], subjectIds: ids })
      .expect(201);
    classId = c.body.id;
    sectionA = c.body.sections.find((s: { name: string }) => s.name === 'A').id;
    sectionB = c.body.sections.find((s: { name: string }) => s.name === 'B').id;
    expect(c.body.subjects).toHaveLength(4);

    const h = await http.post(`${API}/hostels`).set(bearer(admin)).send({ name: 'Boys Hostel A' }).expect(201);
    hostelId = h.body.id;
  });
});

describe('students', () => {
  it('creates a student and returns a one-time temporary password', async () => {
    const r = await http
      .post(`${API}/students`)
      .set(bearer(admin))
      .send({
        studentCode: 'mt26s0001',
        fullName: 'Ananya Rao',
        sectionId: sectionA,
        rollNumber: '1',
        guardianName: 'Suresh Rao',
        guardianPhone: '9845012345',
        hostelId,
        roomNumber: '12',
      })
      .expect(201);
    studentId = r.body.student.id;
    studentPassword = r.body.temporaryPassword;
    expect(r.body.student.studentCode).toBe('MT26S0001');
    expect(studentPassword).toMatch(/^[A-Za-z0-9]{10}$/);
    expect(JSON.stringify(r.body)).not.toContain('passwordHash');
  });

  it('enforces unique student IDs (case-insensitive) and roll numbers per section', async () => {
    await http.post(`${API}/students`).set(bearer(admin)).send({ studentCode: 'MT26S0001', fullName: 'X Y', sectionId: sectionB, rollNumber: '9' }).expect(409);
    await http.post(`${API}/students`).set(bearer(admin)).send({ studentCode: 'MT26S0099', fullName: 'X Y', sectionId: sectionA, rollNumber: '1' }).expect(409);
  });

  it('lists and filters students', async () => {
    const r = await http.get(`${API}/students`).query({ search: 'ananya', classId }).set(bearer(admin)).expect(200);
    expect(r.body.total).toBe(1);
    expect(r.body.items[0].hostel.name).toBe('Boys Hostel A');
    const none = await http.get(`${API}/students`).query({ sectionId: sectionB }).set(bearer(admin)).expect(200);
    expect(none.body.total).toBe(0);
    const inHostel = await http.get(`${API}/students`).query({ residence: 'hostel' }).set(bearer(admin)).expect(200);
    expect(inHostel.body.items.every((x: { hostel: unknown }) => x.hostel)).toBe(true);
    const day = await http.get(`${API}/students`).query({ residence: 'day' }).set(bearer(admin)).expect(200);
    expect(day.body.items.every((x: { hostel: unknown }) => !x.hostel)).toBe(true);
    expect(inHostel.body.total + day.body.total).toBe((await http.get(`${API}/students`).set(bearer(admin))).body.total);
    const girls = await http.get(`${API}/students`).query({ gender: 'FEMALE' }).set(bearer(admin)).expect(200);
    expect(girls.body.items.every((x: { gender: string }) => x.gender === 'FEMALE')).toBe(true);
    await http.get(`${API}/students`).query({ gender: 'girls' }).set(bearer(admin)).expect(400);
  });

  it('imports a CSV only when every row is valid', async () => {
    const bad =
      'Student ID,Name,Class,Section,Roll No,Gender,Hostel\n' +
      'MT26S0100,Asha K,1st PUC PCMB,A,2,female,Boys Hostel A\n' +
      'MT26S0101,Ravi,1st PUC PCMB,Z,3,,\n' +
      'MT26S0001,Dup,1st PUC PCMB,B,4,,\n';
    const check = await http
      .post(`${API}/students/import`)
      .query({ dryRun: 'false' })
      .set(bearer(admin))
      .attach('file', Buffer.from(bad), 'list.csv')
      .expect(200);
    expect(check.body.valid).toBe(false);
    expect(check.body.created).toBe(0);
    expect(check.body.errors.map((e: { row: number }) => e.row)).toEqual([3, 4]);

    const good =
      'studentCode,fullName,className,sectionName,rollNumber,dateOfBirth\n' +
      'MT26S0100,Asha K,1st PUC PCMB,A,2,2009-04-02\n' +
      'MT26S0101,Ravi M,1st PUC PCMB,B,1,\n';
    const dry = await http.post(`${API}/students/import`).set(bearer(admin)).attach('file', Buffer.from(good), 'list.csv').expect(200);
    expect(dry.body).toMatchObject({ dryRun: true, valid: true, created: 0 });
    const real = await http
      .post(`${API}/students/import`)
      .query({ dryRun: 'false' })
      .set(bearer(admin))
      .attach('file', Buffer.from(good), 'list.csv')
      .expect(200);
    expect(real.body.created).toBe(2);
    expect(real.body.credentials).toHaveLength(2);
  });

  it('transfers a student and records it in the audit log', async () => {
    await http.post(`${API}/students/${studentId}/transfer`).set(bearer(admin)).send({ sectionId: sectionB, rollNumber: '1' }).expect(409); // roll taken by Ravi
    const r = await http
      .post(`${API}/students/${studentId}/transfer`)
      .set(bearer(admin))
      .send({ sectionId: sectionB, rollNumber: '7', reason: 'Parent request' })
      .expect(200);
    expect(r.body.section.id).toBe(sectionB);
    const log = await http.get(`${API}/audit-logs`).query({ entityType: 'student', entityId: studentId }).set(bearer(admin)).expect(200);
    expect(log.body.items.map((i: { action: string }) => i.action)).toContain('student.transfer');
  });

  it('accepts a real image as a photo and rejects anything else', async () => {
    const png = Buffer.from(
      '89504e470d0a1a0a0000000d4948445200000001000000010806000000' + '1f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4500000000049454e44ae426082',
      'hex',
    );
    await http.post(`${API}/students/${studentId}/photo`).set(bearer(admin)).attach('file', Buffer.from('<svg/>'), 'x.png').expect(400);
    const r = await http.post(`${API}/students/${studentId}/photo`).set(bearer(admin)).attach('file', png, 'p.png').expect(200);
    expect(r.body.hasPhoto).toBe(true);
    const img = await http.get(`${API}/students/${studentId}/photo`).set(bearer(admin)).expect(200);
    expect(img.headers['content-type']).toBe('image/png');
  });
});

describe('student app sign-in', () => {
  let studentAccess: string;
  let studentRefresh: string;

  it('signs in with the temporary password and must change it', async () => {
    const r = await http
      .post(`${API}/auth/student/login`)
      .send({ studentCode: 'mt26s0001', secret: studentPassword })
      .expect(200);
    expect(r.body.mustChangePassword).toBe(true);
    studentAccess = r.body.accessToken;
    await http
      .post(`${API}/auth/change-password`)
      .set(bearer(studentAccess))
      .send({ currentPassword: studentPassword, newPassword: 'MyNewPass1' })
      .expect(204);
  });

  it('cannot use a PIN before one is set, then can after', async () => {
    await http.post(`${API}/auth/student/login`).send({ studentCode: 'MT26S0001', secret: '4821', secretType: 'pin' }).expect(401);
    await http.post(`${API}/auth/student/pin`).set(bearer(studentAccess)).send({ currentPassword: 'MyNewPass1', pin: '4821' }).expect(204);
    const r = await http.post(`${API}/auth/student/login`).send({ studentCode: 'MT26S0001', secret: '4821', secretType: 'pin' }).expect(200);
    studentAccess = r.body.accessToken;
    studentRefresh = r.body.refreshToken;
    expect(r.body.hasPin).toBe(true);
  });

  it('returns the home payload with subjects for the student only', async () => {
    const r = await http.get(`${API}/me/student/home`).set(bearer(studentAccess)).expect(200);
    expect(r.body.profile.fullName).toBe('Ananya Rao');
    expect(r.body.profile.classGroup.name).toBe('1st PUC PCMB');
    expect(r.body.subjects.map((s: { code: string }) => s.code).sort()).toEqual(['BIO', 'CHE', 'MAT', 'PHY']);
    // Students cannot reach staff endpoints, and staff cannot reach student endpoints.
    await http.get(`${API}/students`).set(bearer(studentAccess)).expect(403);
    await http.get(`${API}/me/student/home`).set(bearer(admin)).expect(403);
  });

  it('suspending the student ends their session', async () => {
    await http.patch(`${API}/students/${studentId}/status`).set(bearer(admin)).send({ status: 'SUSPENDED', reason: 'Test' }).expect(200);
    await http.post(`${API}/auth/refresh`).send({ refreshToken: studentRefresh }).expect(401);
    await http.post(`${API}/auth/student/login`).send({ studentCode: 'MT26S0001', secret: 'MyNewPass1' }).expect(403);
    await http.patch(`${API}/students/${studentId}/status`).set(bearer(admin)).send({ status: 'ACTIVE' }).expect(200);
  });

  it('locks sign-in after repeated failures; a reset unlocks it and clears the PIN', async () => {
    for (let i = 0; i < 5; i++) {
      await http.post(`${API}/auth/student/login`).send({ studentCode: 'MT26S0001', secret: 'wrong-pass-9' }).expect(401);
    }
    const locked = await http.post(`${API}/auth/student/login`).send({ studentCode: 'MT26S0001', secret: 'MyNewPass1' }).expect(403);
    expect(locked.body.message).toMatch(/Too many failed attempts/);

    const reset = await http.post(`${API}/students/${studentId}/reset-credentials`).set(bearer(admin)).expect(200);
    const r = await http.post(`${API}/auth/student/login`).send({ studentCode: 'MT26S0001', secret: reset.body.temporaryPassword }).expect(200);
    expect(r.body.mustChangePassword).toBe(true);
    expect(r.body.hasPin).toBe(false);
  });
});

describe('tablets', () => {
  it('enrols, assigns, prevents double assignment and unassigns', async () => {
    const t = await http.post(`${API}/tablets`).set(bearer(admin)).send({ serialNumber: 'r9tx001', model: 'Galaxy Tab A9+' }).expect(201);
    tabletId = t.body.id;
    expect(t.body.serialNumber).toBe('R9TX001');
    await http.post(`${API}/tablets`).set(bearer(admin)).send({ serialNumber: 'R9TX001', model: 'Dup' }).expect(409);

    const a = await http.post(`${API}/tablets/${tabletId}/assign`).set(bearer(admin)).send({ studentId }).expect(200);
    expect(a.body.status).toBe('ASSIGNED');
    expect(a.body.student.id).toBe(studentId);

    const t2 = await http.post(`${API}/tablets`).set(bearer(admin)).send({ serialNumber: 'R9TX002', model: 'Galaxy Tab A9+' }).expect(201);
    await http.post(`${API}/tablets/${t2.body.id}/assign`).set(bearer(admin)).send({ studentId }).expect(409);
    await http.post(`${API}/tablets/${tabletId}/assign`).set(bearer(admin)).send({ studentId }).expect(409);
  });

  it('accepts heartbeats only from the assigned tablet', async () => {
    const reset = await http.post(`${API}/students/${studentId}/reset-credentials`).set(bearer(admin)).expect(200);
    const login = await http
      .post(`${API}/auth/student/login`)
      .send({ studentCode: 'MT26S0001', secret: reset.body.temporaryPassword, deviceSerial: 'r9tx001' })
      .expect(200);
    const tok = login.body.accessToken;
    const ok = await http.post(`${API}/me/device/heartbeat`).set(bearer(tok)).send({ serialNumber: 'R9TX001', appVersion: '0.1.0+1' }).expect(200);
    expect(ok.body.matched).toBe(true);
    const other = await http.post(`${API}/me/device/heartbeat`).set(bearer(tok)).send({ serialNumber: 'R9TX002' }).expect(200);
    expect(other.body.matched).toBe(false);
    const t = await http.get(`${API}/tablets/${tabletId}`).set(bearer(admin)).expect(200);
    expect(t.body.appVersion).toBe('0.1.0+1');
    expect(t.body.lastSeenAt).not.toBeNull();
  });

  it('marking a tablet lost removes the assignment', async () => {
    const r = await http.patch(`${API}/tablets/${tabletId}/status`).set(bearer(admin)).send({ status: 'LOST', reason: 'Reported by warden' }).expect(200);
    expect(r.body.status).toBe('LOST');
    expect(r.body.student).toBeNull();
  });
});

describe('roles and permissions', () => {
  let teacher: string;
  let warden: string;

  it('a College Administrator cannot create a Super Administrator', async () => {
    const ca = await http.post(`${API}/staff`).set(bearer(admin)).send({ email: 'ca@test.local', fullName: 'College Admin', role: 'COLLEGE_ADMIN' }).expect(201);
    const login = await http.post(`${API}/auth/staff/login`).send({ email: 'ca@test.local', password: ca.body.temporaryPassword }).expect(200);
    expect(login.body.mustChangePassword).toBe(true);
    await http
      .post(`${API}/staff`)
      .set(bearer(login.body.accessToken))
      .send({ email: 'sa2@test.local', fullName: 'Another Super', role: 'SUPER_ADMIN' })
      .expect(403);
  });

  it('a teacher can read students but not change them, and does not see guardian details', async () => {
    const t = await http.post(`${API}/staff`).set(bearer(admin)).send({ email: 'Teacher@Test.local', fullName: 'Teacher One', role: 'TEACHER' }).expect(201);
    expect(t.body.staff.email).toBe('teacher@test.local');
    teacher = await staffToken(http, 'teacher@test.local', t.body.temporaryPassword);
    const list = await http.get(`${API}/students`).query({ search: 'ananya' }).set(bearer(teacher)).expect(200);
    expect(list.body.items[0].guardianPhone).toBeNull();
    await http.post(`${API}/students`).set(bearer(teacher)).send({ studentCode: 'X123', fullName: 'X Y', sectionId: sectionA, rollNumber: '50' }).expect(403);
    await http.get(`${API}/audit-logs`).set(bearer(teacher)).expect(403);
    await http.get(`${API}/tablets`).set(bearer(teacher)).expect(403);
    const dash = await http.get(`${API}/dashboard/summary`).set(bearer(teacher)).expect(200);
    expect(dash.body.recentActivity).toBeNull();
  });

  it('a hostel warden sees guardian details and can be assigned to a hostel', async () => {
    const w = await http.post(`${API}/staff`).set(bearer(admin)).send({ email: 'warden@test.local', fullName: 'Warden', role: 'HOSTEL_WARDEN' }).expect(201);
    warden = await staffToken(http, 'warden@test.local', w.body.temporaryPassword);
    const list = await http.get(`${API}/students`).query({ search: 'ananya' }).set(bearer(warden)).expect(200);
    expect(list.body.items[0].guardianPhone).toBe('9845012345');
    await http.patch(`${API}/hostels/${hostelId}`).set(bearer(admin)).send({ wardenId: w.body.staff.id }).expect(200);
    // Only staff with the warden role can be a warden.
    const teacherRow = await pool.query(`select id from staff_users where email = 'teacher@test.local'`);
    await http.patch(`${API}/hostels/${hostelId}`).set(bearer(admin)).send({ wardenId: teacherRow.rows[0].id }).expect(400);
  });

  it('suspending a staff member ends their sessions', async () => {
    const row = await pool.query(`select id from staff_users where email = 'warden@test.local'`);
    const login = await http.post(`${API}/auth/staff/login`).send({ email: 'warden@test.local', password: 'irrelevant' });
    expect(login.status).toBe(401);
    await http.patch(`${API}/staff/${row.rows[0].id}/status`).set(bearer(admin)).send({ status: 'SUSPENDED' }).expect(200);
    const sessions = await pool.query(`select count(*)::int as n from sessions where staff_id = $1 and revoked_at is null`, [row.rows[0].id]);
    expect(sessions.rows[0].n).toBe(0);
  });

  it('nobody can change their own status or role', async () => {
    const me = await http.get(`${API}/auth/me`).set(bearer(admin)).expect(200);
    await http.patch(`${API}/staff/${me.body.id}/status`).set(bearer(admin)).send({ status: 'SUSPENDED' }).expect(403);
    await http.patch(`${API}/staff/${me.body.id}`).set(bearer(admin)).send({ role: 'TEACHER' }).expect(403);
  });
});

describe('dashboard', () => {
  it('summarises the college', async () => {
    const r = await http.get(`${API}/dashboard/summary`).set(bearer(admin)).expect(200);
    expect(r.body.academicYear.name).toBe('2026-27');
    expect(r.body.students.active).toBe(3);
    expect(r.body.tablets.total).toBe(2);
    expect(r.body.classes[0].students).toBe(3);
    expect(r.body.recentActivity.length).toBeGreaterThan(0);
  });
});
