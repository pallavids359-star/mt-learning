import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const BANK_ID = 64;

export class ExamQueryDto {
  @ApiProperty() @IsString() @MaxLength(BANK_ID) examId: string;
}

export class HistoryQueryDto extends ExamQueryDto {
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) page?: number;
}

export class TargetDto {
  @ApiProperty() @IsString() @MaxLength(BANK_ID) examId: string;
}

export class PracticeDto {
  @ApiProperty() @IsString() @MaxLength(BANK_ID) examId: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(60)
  @IsString({ each: true })
  @MaxLength(BANK_ID, { each: true })
  chapterIds: string[];

  @ApiPropertyOptional({ type: [String], description: 'Ticked topics; a chapter with none ticked gives all of it' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(300)
  @IsString({ each: true })
  @MaxLength(BANK_ID, { each: true })
  topicIds?: string[];

  @ApiPropertyOptional({ enum: ['any', 'easy', 'medium', 'hard'], default: 'any' })
  @IsOptional()
  @IsIn(['any', 'easy', 'medium', 'hard'])
  difficulty?: 'any' | 'easy' | 'medium' | 'hard';

  @ApiPropertyOptional({ default: 10 }) @IsOptional() @IsInt() @Min(1) @Max(60) count?: number;
}

export class MockDto {
  @ApiProperty() @IsString() @MaxLength(BANK_ID) examId: string;
  @ApiPropertyOptional({ enum: ['PCM', 'PCB'], description: 'KCET only' }) @IsOptional() @IsIn(['PCM', 'PCB']) stream?: 'PCM' | 'PCB';
}

export class ReviseDto {
  @ApiProperty() @IsString() @MaxLength(BANK_ID) examId: string;
  @ApiPropertyOptional({ default: 10 }) @IsOptional() @IsInt() @Min(1) @Max(60) count?: number;
}

export class AnswerDto {
  @ApiProperty() @IsString() @MaxLength(BANK_ID) questionId: string;

  @ApiPropertyOptional({ type: [String], example: ['B'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @IsIn(['A', 'B', 'C', 'D'], { each: true })
  selected?: string[];

  @ApiPropertyOptional() @IsOptional() @IsNumber({ allowNaN: false, allowInfinity: false }) numerical?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() marked?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(86_400) timeSec?: number;
}

export class AnswersDto {
  @ApiPropertyOptional({ type: [AnswerDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(250)
  @ValidateNested({ each: true })
  @Type(() => AnswerDto)
  answers?: AnswerDto[];
}

export class BookmarkDto {
  @ApiProperty() @IsString() @MaxLength(BANK_ID) questionId: string;
}

export class BrowseQueryDto {
  @ApiProperty() @IsString() @MaxLength(BANK_ID) chapterId: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10_000) page?: number;
}

/** Staff: pick random questions of one subject for a live test. */
export class PickDto {
  @ApiProperty() @IsString() @MaxLength(BANK_ID) examId: string;
  @ApiProperty() @IsString() @MaxLength(BANK_ID) subjectId: string;

  @ApiPropertyOptional({ type: [String], description: 'Chapters to use; none means the whole subject' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(BANK_ID, { each: true })
  chapterIds?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Ticked topics; a chapter with none ticked gives all of it' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  @MaxLength(BANK_ID, { each: true })
  topicIds?: string[];

  @ApiPropertyOptional({ enum: ['11', '12'], description: 'Only Class 11 or Class 12 chapters' })
  @IsOptional()
  @IsIn(['11', '12'])
  classLevel?: '11' | '12';

  @ApiProperty({ example: 45 }) @IsInt() @Min(1) @Max(300) count: number;

  @ApiPropertyOptional({ type: [String], description: 'Questions already in the test' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @MaxLength(BANK_ID, { each: true })
  exclude?: string[];
}
