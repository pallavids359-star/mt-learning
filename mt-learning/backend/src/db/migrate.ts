/* Applies pending SQL migrations from ./drizzle. Safe to run on every deploy. */
import '../config/dotenv';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { poolConfig } from './pg-config';

export async function runMigrations(databaseUrl: string): Promise<void> {
  const pool = new Pool(poolConfig(databaseUrl, 1));
  try {
    await migrate(drizzle(pool), { migrationsFolder: path.resolve(__dirname, '../../drizzle') });
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  runMigrations(url)
    .then(() => console.log('Migrations applied'))
    .catch((err) => {
      console.error('Migration failed', err);
      process.exit(1);
    });
}
