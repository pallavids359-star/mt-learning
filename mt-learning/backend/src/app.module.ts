import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AcademicModule } from './academic/academic.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { AllExceptionsFilter } from './common/filters/db-exception.filter';
import { AuthGuard } from './common/guards/auth.guard';
import { SmartThrottlerGuard } from './common/guards/throttle.guard';
import { StorageModule } from './common/utils/storage.service';
import { DashboardModule } from './dashboard/dashboard.module';
import { DbModule } from './db/db.module';
import { HealthModule } from './health/health.module';
import { HostelsModule } from './hostels/hostels.module';
import { StaffModule } from './staff/staff.module';
import { StudentPortalModule } from './student-portal/student-portal.module';
import { StudentsModule } from './students/students.module';
import { TabletsModule } from './tablets/tablets.module';
import { AttendanceModule } from './attendance/attendance.module';
import { ScopeModule } from './common/scope.service';
import { LiveModule } from './live/live.module';
import { PrepModule } from './prep/prep.module';
import { MaterialsModule } from './materials/materials.module';
import { NoticesModule } from './notices/notices.module';
import { TeachingModule } from './teaching/teaching.module';
import { TestsModule } from './tests/tests.module';

@Module({
  imports: [
    // General API rate limit per session (see SmartThrottlerGuard); login endpoints apply stricter limits.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 300 }]),
    DbModule,
    StorageModule,
    ScopeModule,
    AuditModule,
    AuthModule,
    HealthModule,
    StaffModule,
    AcademicModule,
    HostelsModule,
    StudentsModule,
    TabletsModule,
    TeachingModule,
    MaterialsModule,
    TestsModule,
    AttendanceModule,
    NoticesModule,
    LiveModule,
    PrepModule,
    DashboardModule,
    StudentPortalModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: SmartThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
