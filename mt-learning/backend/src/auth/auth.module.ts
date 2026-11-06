import { Body, Controller, Get, Global, HttpCode, Module, Post } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthPrincipal, RequestMeta } from '../common/auth-principal';
import { AnyPrincipal, CurrentUser, Public, ReqMeta, StudentOnly } from '../common/decorators';
import { loadEnv } from '../config/env';
import { AuthService } from './auth.service';
import { ChangePasswordDto, RefreshDto, SetPinDto, StaffLoginDto, StudentLoginDto } from './dto/auth.dto';

// Sign-in attempts per minute for one account from one network address (see SmartThrottlerGuard).
const LOGIN_LIMIT = { default: { limit: Number(process.env.LOGIN_RATE_LIMIT_PER_MINUTE ?? 10), ttl: 60_000 } };

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle(LOGIN_LIMIT)
  @Post('staff/login')
  @HttpCode(200)
  staffLogin(@Body() dto: StaffLoginDto, @ReqMeta() meta: RequestMeta) {
    return this.auth.staffLogin(dto, meta);
  }

  @Public()
  @Throttle(LOGIN_LIMIT)
  @Post('student/login')
  @HttpCode(200)
  studentLogin(@Body() dto: StudentLoginDto, @ReqMeta() meta: RequestMeta) {
    return this.auth.studentLogin(dto, meta);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto, @ReqMeta() meta: RequestMeta) {
    return this.auth.refresh(dto.refreshToken, meta);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Body() dto: RefreshDto) {
    await this.auth.logout(dto.refreshToken);
  }

  @ApiBearerAuth()
  @AnyPrincipal()
  @Get('me')
  me(@CurrentUser() user: AuthPrincipal) {
    return this.auth.me(user);
  }

  @ApiBearerAuth()
  @AnyPrincipal()
  @Throttle(LOGIN_LIMIT)
  @Post('change-password')
  @HttpCode(204)
  async changePassword(@CurrentUser() user: AuthPrincipal, @Body() dto: ChangePasswordDto, @ReqMeta() meta: RequestMeta) {
    await this.auth.changePassword(user, dto, meta);
  }

  @ApiBearerAuth()
  @StudentOnly()
  @Throttle(LOGIN_LIMIT)
  @Post('student/pin')
  @HttpCode(204)
  async setPin(@CurrentUser() user: AuthPrincipal, @Body() dto: SetPinDto, @ReqMeta() meta: RequestMeta) {
    await this.auth.setStudentPin(user, dto, meta);
  }
}

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      global: true,
      useFactory: () => {
        const env = loadEnv();
        return {
          secret: env.JWT_ACCESS_SECRET,
          signOptions: { expiresIn: env.JWT_ACCESS_TTL_SECONDS, issuer: 'mt-tablet', audience: 'mt-tablet' },
          verifyOptions: { issuer: 'mt-tablet', audience: 'mt-tablet', algorithms: ['HS256'] },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
