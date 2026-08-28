import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MsaidiziTaskMode } from '@prisma/client';
import { MsaidiziTaskBudgetDto } from '../../msaidizi-tasks/dto/msaidizi-task.dto';

/**
 * A proposal request is intentionally smaller than PlanMsaidiziTaskDto: callers
 * provide intent and an explicit mode, while the reasoning plane proposes the
 * typed DAG. The endpoint never persists or queues its result.
 */
export class ProposeMsaidiziTaskDto {
  @ApiPropertyOptional({
    description:
      'Caller-owned PLANNING draft whose objective, mode, company, mandate, budgets, and artifacts govern this proposal',
  })
  @IsOptional()
  @IsUUID('4')
  taskId?: string;

  @ApiProperty({ description: 'Free-text outcome to turn into a reviewed task plan' })
  @IsString()
  @MinLength(1)
  @MaxLength(8_000)
  objective!: string;

  @ApiProperty({
    enum: MsaidiziTaskMode,
    description: 'Required explicitly; mode escalation is never inferred from prose',
  })
  @IsEnum(MsaidiziTaskMode)
  mode!: MsaidiziTaskMode;

  @ApiPropertyOptional({ description: 'Optional user-authored title hint' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  titleHint?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  companyId?: string;

  @ApiPropertyOptional({ description: 'Active mandate to evaluate; required for Autopilot' })
  @IsOptional()
  @IsUUID('4')
  mandateId?: string;

  @ApiPropertyOptional({
    description: 'Explicit workstation selection when a mandate contains multiple devices',
  })
  @IsOptional()
  @IsUUID('4')
  deviceId?: string;

  @ApiPropertyOptional({ type: MsaidiziTaskBudgetDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => MsaidiziTaskBudgetDto)
  budgets?: MsaidiziTaskBudgetDto;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  inputs: Record<string, unknown> = {};

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  stopConditions: Record<string, unknown> = {};

  @ApiPropertyOptional({
    type: [String],
    description:
      'Optional exact memory scopes; runtime-authored records additionally require the exact caller-owned task, mandate, company, and device authority',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(240, { each: true })
  memoryScopeKeys?: string[];

  @ApiPropertyOptional({
    type: [String],
    description:
      'Encrypted artifacts owned by taskId to expose only to the untrusted, read-enrichment model phase',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  artifactIds?: string[];
}
