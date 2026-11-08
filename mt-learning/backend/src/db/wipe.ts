/**
 * Deletes ALL college data and keeps only the Super Administrator sign-ins.
 * Run:  npx ts-node src/db/wipe.ts --yes
 * The GenPrep question bank is a separate, read-only database and is not touched.
 */
import '../config/dotenv';
import { getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { Pool } from 'pg';
import { poolConfig } from './pg-config';
import * as schema from './schema';

async function main() {
  if (!process.argv.includes('--yes')) {
    console.log('This deletes ALL college data. To go ahead, run:  npx ts-node src/db/wipe.ts --yes');
    process.exit(1);
  }
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to wipe a production database');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');

  const tables = (Object.values(schema) as unknown[])
    .filter((t): t is PgTable => is(t, PgTable))
    .map((t) => getTableName(t))
    .filter((name) => name !== 'staff_users');

  const pool = new Pool(poolConfig(url, 1));
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`truncate table ${tables.map((n) => `"${n}"`).join(', ')} restart identity cascade`);
    const { rowCount } = await client.query(`delete from staff_users where role <> 'SUPER_ADMIN'`);
    const { rows } = await client.query<{ email: string }>(`select email from staff_users order by email`);
    await client.query('commit');
    console.log(`Emptied ${tables.length} tables and removed ${rowCount ?? 0} staff accounts.`);
    console.log(`Kept Super Administrator sign-in: ${rows.map((r) => r.email).join(', ') || '(none)'}`);
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
