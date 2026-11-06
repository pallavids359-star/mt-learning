import { Global, Inject, Injectable, Module, OnApplicationShutdown } from '@nestjs/common';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { loadEnv } from '../config/env';
import { poolConfig } from './pg-config';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;
/** A database handle that may be the root connection or a transaction. */
export type DbOrTx = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

export const PG_POOL = Symbol('PG_POOL');
export const DB = Symbol('DB');

/** Inject the Drizzle database handle. */
export const InjectDb = () => Inject(DB);

@Injectable()
class PoolCloser implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}
  async onApplicationShutdown() {
    await this.pool.end();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      useFactory: () => {
        const env = loadEnv();
        return new Pool(poolConfig(env.DATABASE_URL, env.DATABASE_POOL_MAX));
      },
    },
    {
      provide: DB,
      inject: [PG_POOL],
      useFactory: (pool: Pool): Database => drizzle(pool, { schema }),
    },
    PoolCloser,
  ],
  exports: [DB, PG_POOL],
})
export class DbModule {}
