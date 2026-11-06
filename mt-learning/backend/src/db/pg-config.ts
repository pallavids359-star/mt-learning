import fs from 'node:fs';
import type { PoolConfig } from 'pg';

export type SslMode = 'off' | 'require' | 'verify';

/**
 * How to secure the database connection.
 *  - off:     plain connection (local PostgreSQL, Docker network).
 *  - require: encrypted, without checking the server certificate.
 *  - verify:  encrypted and the certificate is checked (DATABASE_CA_FILE for a private CA such as Supabase's).
 * Default: `require` for hosted databases (Supabase, Neon, RDS…), `off` for localhost.
 */
export function sslMode(url: string, setting = process.env.DATABASE_SSL): SslMode {
  if (setting === 'off' || setting === 'require' || setting === 'verify') return setting;
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    return 'off';
  }
  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1' || !host.includes('.');
  return local ? 'off' : 'require';
}

/** Pool settings for a connection string, with SSL handled consistently for the API, migrations and seed. */
export function poolConfig(url: string, max: number): PoolConfig {
  const mode = sslMode(url);
  if (mode === 'off') return { connectionString: url, max };
  // Remove sslmode/ssl from the URL: pg lets them override the ssl object below.
  const u = new URL(url);
  for (const k of ['sslmode', 'ssl', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat']) u.searchParams.delete(k);
  const caFile = process.env.DATABASE_CA_FILE;
  const ssl =
    mode === 'verify'
      ? { rejectUnauthorized: true, ...(caFile ? { ca: fs.readFileSync(caFile, 'utf8') } : {}) }
      : { rejectUnauthorized: false };
  return { connectionString: u.toString(), max, ssl };
}
