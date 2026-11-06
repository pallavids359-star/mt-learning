import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { pucYear, type PucYear } from '../db/schema';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateAcademicYearDto {
  @ApiProperty({ example: '2026-27' })
  @Transform(trim)
  @Matches(/^\d{4}-\d{2}$/, { message: 'Name must look like 2026-27' })
  name: string;

  @ApiProperty({ example: '2026-06-01' }) @IsDateString({ strict: true }) startDate: string;
  @ApiProperty({ example: '2027-03-31' }) @IsDateString({ strict: true }) endDate: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isCurrent?: boolean;
}

export class UpdateAcademicYearDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString({ strict: true }) startDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString({ strict: true }) endDate?: string;
}

export class CreateClassDto {
  @ApiProperty() @IsUUID() academicYearId: string;
  @ApiProperty({ enum: pucYear.enumValues }) @IsIn(pucYear.enumValues) pucYear: PucYear;
  @ApiProperty({ example: 'PCMB' }) @Transform(trim) @IsString() @MinLength(1) @MaxLength(40) stream: string;
  @ApiProperty({ example: '1st PUC Science (PCMB)' }) @Transform(trim) @IsString() @MinLength(2) @MaxLength(80) name: string;

  @ApiPropertyOptional({ example: ['A', 'B'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(26)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(20, { each: true })
  sectionNames?: string[];

  @ApiPropertyOptional() @IsOptional() @IsArray() @ArrayUnique() @IsUUID('all', { each: true }) subjectIds?: string[];
}

export class UpdateClassDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(40) stream?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(80) name?: string;
}

export class SetClassSubjectsDto {
  @ApiProperty() @IsArray() @ArrayUnique() @ArrayMaxSize(20) @IsUUID('all', { each: true }) subjectIds: string[];
}

export class SectionDto {
  @ApiProperty({ example: 'A' }) @Transform(trim) @IsString() @MinLength(1) @MaxLength(20) name: string;
}

export class ClassQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() academicYearId?: string;
}

export class CreateSubjectDto {
  @ApiProperty({ example: 'PHY' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z0-9_-]{2,12}$/, { message: 'Code must be 2–12 letters, digits, - or _' })
  code: string;

  @ApiProperty({ example: 'Physics' }) @Transform(trim) @IsString() @MinLength(2) @MaxLength(80) name: string;
}

export class UpdateSubjectDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
