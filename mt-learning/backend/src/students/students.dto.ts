import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { PageQueryDto } from '../common/dto/pagination.dto';
import { accountStatus, gender, pucYear, type AccountStatus, type Gender, type PucYear } from '../db/schema';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);

export const STUDENT_CODE_RULE = /^[A-Z0-9][A-Z0-9\-/]{2,39}$/;
export const PHONE_RULE = /^[+0-9][0-9 \-]{6,19}$/;

export class CreateStudentDto {
  @ApiProperty({ example: 'MT26S0001' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(STUDENT_CODE_RULE, { message: 'Student ID must be 3–40 letters, digits, - or /' })
  studentCode: string;

  @ApiProperty() @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) fullName: string;
  /** An existing section, or give `pucYear` (and optionally `sectionName`) instead. */
  @ApiPropertyOptional() @ValidateIf((o: CreateStudentDto) => !o.pucYear) @IsUUID() sectionId?: string;
  @ApiPropertyOptional({ enum: pucYear.enumValues, description: 'Class 11 or 12 in the current academic year; created if needed' })
  @ValidateIf((o: CreateStudentDto) => !o.sectionId)
  @IsIn(pucYear.enumValues, { message: 'Choose Class 11 or Class 12' })
  pucYear?: PucYear;
  @ApiPropertyOptional({ example: 'A', description: 'Section letter with pucYear; A when left out' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() || undefined : value))
  @Matches(/^[A-Z0-9]{1,5}$/, { message: 'Section must be a letter such as A' })
  sectionName?: string;
  @ApiPropertyOptional({ example: '12', description: 'Last 3 digits of the Student ID when left out' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  rollNumber?: string;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(emptyToNull) @ValidateIf((_, v) => v !== null) @IsDateString({ strict: true }) dateOfBirth?: string | null;
  @ApiPropertyOptional({ enum: gender.enumValues, nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsIn(gender.enumValues) gender?: Gender | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(emptyToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(120) guardianName?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(emptyToNull) @ValidateIf((_, v) => v !== null) @Matches(PHONE_RULE, { message: 'Invalid guardian phone number' }) guardianPhone?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() hostelId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(emptyToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(20) roomNumber?: string | null;
}

export class UpdateStudentDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) fullName?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(20) rollNumber?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(emptyToNull) @ValidateIf((_, v) => v !== null) @IsDateString({ strict: true }) dateOfBirth?: string | null;
  @ApiPropertyOptional({ enum: gender.enumValues, nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsIn(gender.enumValues) gender?: Gender | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(emptyToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(120) guardianName?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(emptyToNull) @ValidateIf((_, v) => v !== null) @Matches(PHONE_RULE, { message: 'Invalid guardian phone number' }) guardianPhone?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() hostelId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(emptyToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(20) roomNumber?: string | null;
}

export class StudentStatusDto {
  @ApiProperty({ enum: accountStatus.enumValues }) @IsIn(accountStatus.enumValues) status: AccountStatus;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(300) reason?: string;
}

export class TransferStudentDto {
  @ApiProperty() @IsUUID() sectionId: string;
  @ApiProperty() @Transform(trim) @IsString() @MinLength(1) @MaxLength(20) rollNumber: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(300) reason?: string;
}

export class StudentQueryDto extends PageQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() classId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() sectionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() hostelId?: string;
  @ApiPropertyOptional({ enum: ['hostel', 'day'], description: 'hostel = lives in any hostel; day = day scholar (no hostel)' })
  @IsOptional()
  @IsIn(['hostel', 'day'])
  residence?: 'hostel' | 'day';
  @ApiPropertyOptional({ enum: gender.enumValues }) @IsOptional() @IsIn(gender.enumValues) gender?: Gender;
  @ApiPropertyOptional({ enum: accountStatus.enumValues }) @IsOptional() @IsIn(accountStatus.enumValues) status?: AccountStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  hasTablet?: boolean;
}

export class ImportQueryDto {
  @ApiPropertyOptional({ default: true, description: 'Validate only; nothing is saved' })
  @IsOptional()
  @Transform(({ value }) => value !== 'false' && value !== false)
  @IsBoolean()
  dryRun: boolean = true;

  @ApiPropertyOptional({ description: 'Academic year whose classes the CSV refers to (default: current)' })
  @IsOptional()
  @IsUUID()
  academicYearId?: string;
}

/** Shape of one CSV row after header normalisation. */
export class ImportRowDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(STUDENT_CODE_RULE, { message: 'studentCode must be 3–40 letters, digits, - or /' })
  studentCode: string;

  @Transform(trim) @IsString() @MinLength(2, { message: 'fullName is required' }) @MaxLength(120) fullName: string;
  @Transform(trim) @IsString() @MinLength(1, { message: 'className is required' }) @MaxLength(80) className: string;
  @Transform(trim) @IsString() @MinLength(1, { message: 'sectionName is required' }) @MaxLength(20) sectionName: string;
  @Transform(trim) @IsString() @MinLength(1, { message: 'rollNumber is required' }) @MaxLength(20) rollNumber: string;
  @IsOptional() @Transform(emptyToNull) @ValidateIf((_, v) => v !== null) @IsDateString({ strict: true }, { message: 'dateOfBirth must be YYYY-MM-DD' }) dateOfBirth?: string | null;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() || null : value))
  @ValidateIf((_, v) => v !== null)
  @IsIn(gender.enumValues, { message: 'gender must be MALE, FEMALE or OTHER' })
  gender?: Gender | null;

  @IsOptional() @Transform(emptyToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(120) guardianName?: string | null;
  @IsOptional() @Transform(emptyToNull) @ValidateIf((_, v) => v !== null) @Matches(PHONE_RULE, { message: 'guardianPhone is not a valid phone number' }) guardianPhone?: string | null;
  @IsOptional() @Transform(emptyToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(80) hostelName?: string | null;
  @IsOptional() @Transform(emptyToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(20) roomNumber?: string | null;
}
