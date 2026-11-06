import { Controller, Get, Module, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { sql } from 'drizzle-orm';
import { Public } from '../common/decorators';
import { InjectDb, type Database } from '../db/db.module';

@ApiTags('Health')
@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(@InjectDb() private readonly db: Database) {}

  /** Liveness: the process is up. */
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  /** Readiness: the database is reachable. */
  @Get('ready')
  async ready() {
    try {
      await this.db.execute(sql`select 1`);
      return { status: 'ok', database: 'up' };
    } catch {
      throw new ServiceUnavailableException({ status: 'error', database: 'down' });
    }
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
