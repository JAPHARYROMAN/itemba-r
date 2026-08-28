import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsIn,
  IsISO8601,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  MsaidiziEffect,
  MsaidiziMandateStatus,
  MsaidiziMemoryKind,
  MsaidiziScheduleStatus,
  MsaidiziTrustLevel,
} from '@prisma/client';

export class MandateCapabilityDto {
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  capability!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  version?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(4)
  @IsEnum(MsaidiziEffect, { each: true })
  effects!: MsaidiziEffect[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(32)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  dataClasses!: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1)
  @IsIn(['emergency_operator'], { each: true })
  consentGrants: string[] = [];

  /**
   * Dynamic HTTPS destinations are never inferred from a broad capability
   * grant. A mandate must name this authority explicitly; omission preserves
   * the compatible static-endpoint-only behavior.
   */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2)
  @ArrayUnique()
  @IsIn(['static_endpoint_v1', 'mandate_dynamic_https_v1'], { each: true })
  externalDestinationAuthorities?: string[];
}

export class MandateBudgetDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(7_200)
  maxWallTimeSeconds?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  maxModelTurns?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  maxAttemptedToolCalls?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  maxMutations?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5_368_709_120)
  maxLocalBytes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(262_144_000)
  maxExternalEgressBytes?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(20)
  maxModelCostUsd?: number;
}

export class CreateMsaidiziMandateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4_000)
  description!: string;

  @IsOptional()
  @IsUUID('4')
  companyId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => MandateCapabilityDto)
  capabilities!: MandateCapabilityDto[];

  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  deviceIds!: string[];

  @ValidateNested()
  @Type(() => MandateBudgetDto)
  budgets!: MandateBudgetDto;

  @IsOptional()
  @IsISO8601({ strict: true })
  startsAt?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  expiresAt?: string;
}

export class UpdateMsaidiziMandateDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(4_000)
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => MandateCapabilityDto)
  capabilities?: MandateCapabilityDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  deviceIds?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => MandateBudgetDto)
  budgets?: MandateBudgetDto;

  @IsOptional()
  @IsISO8601({ strict: true })
  startsAt?: string | null;

  @IsOptional()
  @IsISO8601({ strict: true })
  expiresAt?: string | null;
}

export class VersionedMandateActionDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class QueryMsaidiziMandatesDto {
  @IsOptional()
  @IsEnum(MsaidiziMandateStatus)
  status?: MsaidiziMandateStatus;

  @IsOptional()
  @IsUUID('4')
  companyId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit = 25;
}

export enum MsaidiziScheduleConcurrencyMode {
  SKIP = 'SKIP',
  QUEUE = 'QUEUE',
}

export class CreateMsaidiziScheduleDto {
  @IsUUID('4')
  mandateId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @IsString()
  @Matches(/^\S+(?:\s+\S+){4,5}$/, {
    message: 'cronExpression must have five or six whitespace-separated fields',
  })
  @MaxLength(120)
  cronExpression!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  timezone!: string;

  @IsObject()
  taskTemplate!: Record<string, unknown>;

  @IsOptional()
  @IsEnum(MsaidiziScheduleConcurrencyMode)
  concurrencyMode: MsaidiziScheduleConcurrencyMode = MsaidiziScheduleConcurrencyMode.SKIP;

  @IsOptional()
  @IsISO8601({ strict: true })
  nextRunAt?: string;
}

export class UpdateMsaidiziScheduleDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\S+(?:\s+\S+){4,5}$/, {
    message: 'cronExpression must have five or six whitespace-separated fields',
  })
  @MaxLength(120)
  cronExpression?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  timezone?: string;

  @IsOptional()
  @IsObject()
  taskTemplate?: Record<string, unknown>;

  @IsOptional()
  @IsEnum(MsaidiziScheduleConcurrencyMode)
  concurrencyMode?: MsaidiziScheduleConcurrencyMode;

  @IsOptional()
  @IsISO8601({ strict: true })
  nextRunAt?: string | null;
}

export class VersionedScheduleActionDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class QueryMsaidiziSchedulesDto {
  @IsOptional()
  @IsEnum(MsaidiziScheduleStatus)
  status?: MsaidiziScheduleStatus;

  @IsOptional()
  @IsUUID('4')
  mandateId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit = 25;
}

export enum MsaidiziMemorySourceType {
  USER = 'USER',
  TASK = 'TASK',
  FILE = 'FILE',
  WEBPAGE = 'WEBPAGE',
  EMAIL = 'EMAIL',
  CLIPBOARD = 'CLIPBOARD',
  AUDIO = 'AUDIO',
  SCREENSHOT = 'SCREENSHOT',
  SYSTEM = 'SYSTEM',
}

export class MsaidiziMemoryProvenanceDto {
  @IsEnum(MsaidiziMemorySourceType)
  sourceType!: MsaidiziMemorySourceType;

  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  sourceId?: string;

  @IsISO8601({ strict: true })
  capturedAt!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(32)
  @IsString({ each: true })
  @MaxLength(240, { each: true })
  transformations?: string[];
}

export class CreateMsaidiziMemoryDto {
  @IsOptional()
  @IsUUID('4')
  companyId?: string;

  @IsEnum(MsaidiziMemoryKind)
  kind!: MsaidiziMemoryKind;

  @IsString()
  @MinLength(1)
  @MaxLength(240)
  scopeKey!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(250_000)
  content!: string;

  @IsObject()
  metadata!: Record<string, unknown>;

  @IsOptional()
  @IsISO8601({ strict: true })
  expiresAt?: string;
}

export class UpdateMsaidiziMemoryDto {
  @IsOptional()
  @IsEnum(MsaidiziMemoryKind)
  kind?: MsaidiziMemoryKind;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  scopeKey?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(250_000)
  content?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsISO8601({ strict: true })
  expiresAt?: string | null;
}

export class QueryMsaidiziMemoriesDto {
  @IsOptional()
  @IsUUID('4')
  companyId?: string;

  @IsOptional()
  @IsEnum(MsaidiziMemoryKind)
  kind?: MsaidiziMemoryKind;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  scopeKey?: string;

  @IsOptional()
  @IsEnum(MsaidiziTrustLevel)
  trustLevel?: MsaidiziTrustLevel;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit = 25;
}
