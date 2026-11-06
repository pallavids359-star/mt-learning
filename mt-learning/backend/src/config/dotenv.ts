import fs from 'node:fs';
import path from 'node:path';

/**
 * Loads backend/.env for local development (`npm run start:dev`, `db:migrate:dev`, `seed`).
 * Variables already set in the environment win, so production secrets and Docker settings
 * are never overridden by a stray file.
 */
export function loadDotEnv(file = path.resolve(__dirname, '../../.env')): void {
  if (process.env.NODE_ENV === 'test' || !fs.existsSync(file)) return;
  process.loadEnvFile(file);
}

loadDotEnv();
