import './config/dotenv';
import { Logger } from '@nestjs/common';
import { createApp } from './bootstrap';
import { loadEnv } from './config/env';
import { runMigrations } from './db/migrate';

async function main() {
  const env = loadEnv();
  if (process.env.RUN_MIGRATIONS_ON_START === 'true') await runMigrations(env.DATABASE_URL);
  const app = await createApp();
  await app.listen(env.PORT, '0.0.0.0');
  Logger.log(`API listening on port ${env.PORT}`, 'Bootstrap');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
