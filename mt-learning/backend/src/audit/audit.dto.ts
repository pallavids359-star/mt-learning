import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PageQueryDto } from '../common/dto/pagination.dto';

export class AuditQueryDto extends PageQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) action?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) entityType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) entityId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() actorId?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() to?: string;
}
