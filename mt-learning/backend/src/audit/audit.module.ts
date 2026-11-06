import { Controller, Get, Global, Module, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../common/decorators';
import { Permission } from '../common/permissions';
import { AuditQueryDto } from './audit.dto';
import { AuditService } from './audit.service';

@ApiTags('Audit logs')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions(Permission.AuditRead)
  list(@Query() q: AuditQueryDto) {
    return this.audit.list(q);
  }
}

@Global()
@Module({ providers: [AuditService], controllers: [AuditController], exports: [AuditService] })
export class AuditModule {}
