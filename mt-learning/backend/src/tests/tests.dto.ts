import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PageQueryDto } from '../common/dto/pagination.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);

export class QuestionDto {
  @ApiProperty() @Transform(trim) @IsString() @MinLength(2) @MaxLength(4000) text: string;

  @ApiProperty({ type: [String], minItems: 2, maxItems: 6 })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(6)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(1000, { each: true })
  options: string[];

  @ApiProperty({ description: 'Index of the correct option (0 = first)' }) @IsInt() @Min(0) @Max(5) correctIndex: number;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @IsNumber() @Min(0.25) @Max(20) marks?: number;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(120) topic?: string | null;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(4000) explanation?: string | null;
  @ApiPropertyOptional({ description: 'GenPrep question this was copied from' }) @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(64) bankQuestionId?: string | null;
  @ApiPropertyOptional({ description: 'Subject of the question in an exam test, e.g. Physics' }) @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(60) subject?: string | null;
}

export class CreateTestDto {
  @ApiPropertyOptional({ description: 'Older tests: one class' }) @IsOptional() @IsUUID() classId?: string;
  @ApiPropertyOptional({ description: 'Older tests: one subject' }) @IsOptional() @IsUUID() subjectId?: string;
  @ApiPropertyOptional({ enum: ['PUC_1', 'PUC_2', 'BOTH'], description: 'Exam tests: who writes it' }) @IsOptional() @IsIn(['PUC_1', 'PUC_2', 'BOTH']) audience?: 'PUC_1' | 'PUC_2' | 'BOTH';
  @ApiPropertyOptional({ enum: ['NEET', 'JEE', 'KCET'], description: 'Exam tests: decides the subjects' }) @IsOptional() @IsIn(['NEET', 'JEE', 'KCET']) examCode?: 'NEET' | 'JEE' | 'KCET';
  @ApiProperty() @Transform(trim) @IsString() @MinLength(3) @MaxLength(160) title: string;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(2000) instructions?: string | null;
  @ApiProperty({ example: 30 }) @IsInt() @Min(1) @Max(300) durationMin: number;
  @ApiProperty({ example: '2026-11-06T03:30:00.000Z' }) @IsISO8601({ strict: true }) opensAt: string;
  @ApiProperty({ example: '2026-11-06T15:30:00.000Z' }) @IsISO8601({ strict: true }) closesAt: string;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() allowOffline?: boolean;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsNumber() @Min(0) @Max(5) negativeMarks?: number;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() instantResults?: boolean;

  @ApiPropertyOptional({ type: [QuestionDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => QuestionDto)
  questions?: QuestionDto[];
}

export class UpdateTestDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MinLength(3) @MaxLength(160) title?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(2000) instructions?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(300) durationMin?: number;
  @ApiPropertyOptional() @IsOptional() @IsISO8601({ strict: true }) opensAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601({ strict: true }) closesAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allowOffline?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(5) negativeMarks?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() instantResults?: boolean;
}

export class SetQuestionsDto {
  @ApiProperty({ type: [QuestionDto] })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => QuestionDto)
  questions: QuestionDto[];
}

export class TestQueryDto extends PageQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() classId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() subjectId?: string;
  @ApiPropertyOptional({ enum: ['draft', 'upcoming', 'open', 'closed'] }) @IsOptional() @IsIn(['draft', 'upcoming', 'open', 'closed']) status?: 'draft' | 'upcoming' | 'open' | 'closed';
}

export class ReviewDto {
  @ApiProperty({ enum: ['ACCEPTED', 'REJECTED'] }) @IsIn(['ACCEPTED', 'REJECTED']) decision: 'ACCEPTED' | 'REJECTED';
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(300) note?: string | null;
}

export class StartTestDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) deviceSerial?: string;
}

export class SubmitTestDto {
  @ApiProperty({ enum: ['ONLINE', 'OFFLINE'] }) @IsIn(['ONLINE', 'OFFLINE']) mode: 'ONLINE' | 'OFFLINE';

  @ApiProperty({ description: 'questionId → chosen option index, or null when skipped', example: { 'q-uuid': 2 } })
  @IsObject()
  answers: Record<string, number | null>;

  @ApiPropertyOptional() @IsOptional() @IsISO8601({ strict: true }) clientStartedAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601({ strict: true }) clientSubmittedAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(86400) elapsedSec?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) deviceSerial?: string;
  @ApiPropertyOptional({ description: 'Required for OFFLINE: the token from the downloaded test package' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  packageToken?: string;
}

/** Sent by the tablet every few seconds while a student is taking a live test. */
export class ProgressDto {
  @ApiProperty() @IsUUID() attemptId: string;
  @ApiProperty({ description: 'Question on screen, counting from 1' }) @IsInt() @Min(1) @Max(500) currentQuestion: number;
  @ApiProperty({ description: 'questionId → chosen option index, or null' }) @IsObject() answers: Record<string, number | null>;
  @ApiPropertyOptional({ description: 'Questions opened and left without an answer' }) @IsOptional() @IsInt() @Min(0) @Max(500) skipped?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100) battery?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() charging?: boolean;
}

export class ReviveDto {
  @ApiProperty({ description: 'Minutes the student gets from now', minimum: 1, maximum: 300 }) @IsInt() @Min(1) @Max(300) minutes: number;
}

export class MarksQueryDto {
  @ApiProperty() @IsUUID() classId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() sectionId?: string;
}
