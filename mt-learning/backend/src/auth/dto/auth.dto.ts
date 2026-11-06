import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { PASSWORD_RULE, PASSWORD_RULE_MESSAGE, PIN_RULE } from '../../common/utils/secrets';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class StaffLoginDto {
  @ApiProperty({ example: 'admin@college.edu' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password: string;
}

export class StudentLoginDto {
  @ApiProperty({ example: 'MT26S0001', description: 'College-issued student ID' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  studentCode: string;

  @ApiProperty({ description: 'Password or PIN, depending on secretType' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  secret: string;

  @ApiPropertyOptional({ enum: ['password', 'pin'], default: 'password' })
  @IsOptional()
  @IsIn(['password', 'pin'])
  secretType: 'password' | 'pin' = 'password';

  @ApiPropertyOptional({ description: 'Serial number of the tablet the app runs on' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  deviceSerial?: string;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  refreshToken: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MaxLength(128)
  currentPassword: string;

  @ApiProperty()
  @IsString()
  @Matches(PASSWORD_RULE, { message: PASSWORD_RULE_MESSAGE })
  newPassword: string;
}

export class SetPinDto {
  @ApiProperty({ description: 'Current password, to confirm identity' })
  @IsString()
  @MaxLength(128)
  currentPassword: string;

  @ApiProperty({ example: '4821', description: '4–6 digits' })
  @Matches(PIN_RULE, { message: 'PIN must be 4–6 digits' })
  pin: string;
}
