import { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import request from 'supertest';
import { createApp } from '../src/bootstrap';
import { hashSecret } from '../src/common/utils/secrets';
import { runMigrations } from '../src/db/migrate';

export const ADMIN = { email: 'root@test.local', password: 'RootPassword1' };

/** Wipes the test database, applies migrations, creates a Super Administrator and boots the app. */
export async function setupApp(): Promise<{ app: INestApplication; http: ReturnType<typeof request>; pool: Pool }> {
  const url = process.env.DATABASE_URL!;
  const pool = new Pool({ connectionString: url, max: 2 });
  await pool.query('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;');
  await runMigrations(url);
  await pool.query(
    `insert into staff_users (email, full_name, role, password_hash, must_change_password) values ($1, 'Root', 'SUPER_ADMIN', $2, false)`,
    [ADMIN.email, await hashSecret(ADMIN.password)],
  );
  const app = await createApp({ logger: false });
  await app.init();
  return { app, http: request(app.getHttpServer()), pool };
}

export async function staffToken(http: ReturnType<typeof request>, email = ADMIN.email, password = ADMIN.password) {
  const res = await http.post('/api/v1/auth/staff/login').send({ email, password }).expect(200);
  return res.body.accessToken as string;
}

export const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
