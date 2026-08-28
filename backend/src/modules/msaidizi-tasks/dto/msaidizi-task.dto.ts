import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
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
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  MsaidiziEffect,
  MsaidiziExecutionTarget,
  MsaidiziTaskMode,
  MsaidiziTaskStatus,
} from '@prisma/client';

export const MSAIDIZI_INPUT_BINDING_SOURCE_KINDS = [
  'PLAN_INPUT',
  'DEPENDENCY_RESULT',
  'DEPENDENCY_OUTPUT',
  'DEPENDENCY_ARTIFACT',
  'SECRET_REFERENCE',
] as const;

export const MSAIDIZI_INPUT_BINDING_VALUE_TYPES = [
  'string',
  'number',
  'integer',
  'boolean',
  'object',
  'array',
  'null',
] as const;

export const MSAIDIZI_INPUT_BINDING_TRANSFORMS = [
  'IDENTITY',
  'JSON_STRINGIFY',
  'SHA256_HEX',
  'BASE64URL',
] as const;

export class MsaidiziInputBindingSecretScopeDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(180)
  capability!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  capabilityVersion!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  dataClass!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  deviceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  companyId?: string;
}

export class MsaidiziInputBindingSourceDto {
  @ApiProperty({ enum: MSAIDIZI_INPUT_BINDING_SOURCE_KINDS })
  @IsIn(MSAIDIZI_INPUT_BINDING_SOURCE_KINDS)
  kind!: (typeof MSAIDIZI_INPUT_BINDING_SOURCE_KINDS)[number];

  @ApiPropertyOptional({
    description: 'RFC 6901 JSON pointer within the selected immutable source; empty selects root',
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  path: string = '';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^[a-z][a-z0-9_-]{0,63}$/)
  dependencyStepKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  artifactId?: string;

  @ApiPropertyOptional({ description: 'Opaque supervisor-owned handle; never the secret value' })
  @IsOptional()
  @IsUUID()
  secretReferenceId?: string;

  @ApiPropertyOptional({ pattern: '^[a-f0-9]{64}$' })
  @IsOptional()
  @Matches(/^[a-f0-9]{64}$/)
  secretReferenceSha256?: string;

  @ApiPropertyOptional({ type: MsaidiziInputBindingSecretScopeDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => MsaidiziInputBindingSecretScopeDto)
  scope?: MsaidiziInputBindingSecretScopeDto;
}

export class MsaidiziInputBindingTransformDto {
  @ApiProperty({ enum: MSAIDIZI_INPUT_BINDING_TRANSFORMS })
  @IsIn(MSAIDIZI_INPUT_BINDING_TRANSFORMS)
  name!: (typeof MSAIDIZI_INPUT_BINDING_TRANSFORMS)[number];

  @ApiProperty({ enum: ['1'] })
  @IsIn(['1'])
  version!: '1';
}

export class MsaidiziInputBindingDto {
  @ApiProperty({
    description: 'RFC 6901 JSON pointer to an existing null placeholder in step arguments',
  })
  @IsString()
  @Matches(/^\/(?:[^~/]|~0|~1)+(?:\/(?:[^~/]|~0|~1)+)*$/)
  @MaxLength(512)
  targetPath!: string;

  @ApiProperty({ type: MsaidiziInputBindingSourceDto })
  @ValidateNested()
  @Type(() => MsaidiziInputBindingSourceDto)
  source!: MsaidiziInputBindingSourceDto;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  dataClass!: string;

  @ApiProperty({ enum: MSAIDIZI_INPUT_BINDING_VALUE_TYPES })
  @IsIn(MSAIDIZI_INPUT_BINDING_VALUE_TYPES)
  expectedType!: (typeof MSAIDIZI_INPUT_BINDING_VALUE_TYPES)[number];

  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  expectedSchema!: Record<string, unknown>;

  @ApiProperty({ type: MsaidiziInputBindingTransformDto })
  @ValidateNested()
  @Type(() => MsaidiziInputBindingTransformDto)
  transform!: MsaidiziInputBindingTransformDto;
}

export class MsaidiziTaskBudgetDto {
  @ApiPropertyOptional({ minimum: 1, description: 'May lower, never raise, deployment ceiling' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxWallTimeSeconds?: number;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxModelTurns?: number;

  @ApiPropertyOptional({ minimum: 1, description: 'Includes policy-rejected attempts' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxAttemptedToolCalls?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxMutations?: number;

  @ApiPropertyOptional({ minimum: 1, description: 'Combined local read/write byte ceiling' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxLocalBytes?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxExternalEgressBytes?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0)
  maxModelCostUsd?: number;
}

/**
 * Creates the caller-owned persistence envelope used while intent and
 * untrusted media are being assembled. A draft has no plan and cannot be
 * queued or executed.
 */
export class CreateMsaidiziTaskDraftDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(8_000)
  objective!: string;

  @ApiPropertyOptional({
    description: 'Optional provisional title; the reviewed plan may replace it',
  })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  title?: string;

  @ApiProperty({ enum: MsaidiziTaskMode })
  @IsEnum(MsaidiziTaskMode)
  mode!: MsaidiziTaskMode;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  mandateId?: string;

  @ApiPropertyOptional({ description: 'Caller-owned retry key for this exact draft intent' })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  idempotencyKey?: string;

  @ApiPropertyOptional({ type: MsaidiziTaskBudgetDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => MsaidiziTaskBudgetDto)
  budgets?: MsaidiziTaskBudgetDto;
}

export class MsaidiziPlanStepDto {
  @ApiProperty({ example: 'load-expenses' })
  @IsString()
  @Matches(/^[a-z][a-z0-9_-]{0,63}$/)
  key!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @ApiPropertyOptional({ enum: MsaidiziExecutionTarget, default: MsaidiziExecutionTarget.ERP })
  @IsOptional()
  @IsEnum(MsaidiziExecutionTarget)
  target: MsaidiziExecutionTarget = MsaidiziExecutionTarget.ERP;

  @ApiProperty({ description: 'Exact, versioned ERP or host capability name' })
  @IsString()
  @MinLength(1)
  @MaxLength(180)
  capability!: string;

  @ApiPropertyOptional({ default: '1' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  capabilityVersion: string = '1';

  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  arguments!: Record<string, unknown>;

  @ApiPropertyOptional({ type: [String], description: 'Step keys in this plan version' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  dependsOn: string[] = [];

  @ApiPropertyOptional({
    type: [MsaidiziInputBindingDto],
    description:
      'Immutable typed bindings resolved from reviewed inputs or successful declared dependencies',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => MsaidiziInputBindingDto)
  inputBindings: MsaidiziInputBindingDto[] = [];

  @ApiProperty({ enum: MsaidiziEffect })
  @IsEnum(MsaidiziEffect)
  expectedEffect!: MsaidiziEffect;

  @ApiProperty({ example: 'internal' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  dataClass!: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  preconditions: Record<string, unknown> = {};

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  recovery?: Record<string, unknown>;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  budgets: Record<string, unknown> = {};

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  stopConditions: Record<string, unknown> = {};

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  idempotent: boolean = false;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  mutation: boolean = false;
}

export class PlanMsaidiziTaskDto {
  @ApiPropertyOptional({
    description:
      'Caller-owned PLANNING draft to promote atomically; omitted only for the legacy text-only save path',
  })
  @IsOptional()
  @IsUUID()
  taskId?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(8_000)
  objective!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  summary?: string;

  @ApiPropertyOptional({ enum: MsaidiziTaskMode, default: MsaidiziTaskMode.COLLABORATIVE })
  @IsOptional()
  @IsEnum(MsaidiziTaskMode)
  mode: MsaidiziTaskMode = MsaidiziTaskMode.COLLABORATIVE;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  mandateId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  scheduleId?: string;

  @ApiPropertyOptional({ description: 'Caller-owned retry key; never reused across task intents' })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  idempotencyKey?: string;

  @ApiPropertyOptional({
    description: 'One-use server receipt returned with an AI-generated proposal',
  })
  @ValidateIf((dto: PlanMsaidiziTaskDto) => dto.proposalDigest !== undefined)
  @IsUUID('4')
  proposalUsageId?: string;

  @ApiPropertyOptional({
    description: 'Exact proposal digest bound to proposalUsageId',
    pattern: '^[0-9a-f]{64}$',
  })
  @ValidateIf((dto: PlanMsaidiziTaskDto) => dto.proposalUsageId !== undefined)
  @Matches(/^[0-9a-f]{64}$/)
  proposalDigest?: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  inputs: Record<string, unknown> = {};

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  stopConditions: Record<string, unknown> = {};

  @ApiPropertyOptional({ type: MsaidiziTaskBudgetDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => MsaidiziTaskBudgetDto)
  budgets?: MsaidiziTaskBudgetDto;

  @ApiProperty({ type: [MsaidiziPlanStepDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => MsaidiziPlanStepDto)
  steps!: MsaidiziPlanStepDto[];
}

export class CreateMsaidiziTaskDto {
  @ApiProperty({ description: 'READY task returned by POST /msaidizi/tasks/plan' })
  @IsUUID()
  taskId!: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Exact active-plan step IDs receiving one-use consent in this queue action',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  oneShotConsentStepIds: string[] = [];
}

export class ReplanMsaidiziTaskDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(8_000)
  objective?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(2_000)
  summary!: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  inputs: Record<string, unknown> = {};

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  stopConditions: Record<string, unknown> = {};

  @ApiProperty({ type: [MsaidiziPlanStepDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => MsaidiziPlanStepDto)
  steps!: MsaidiziPlanStepDto[];
}

export class QueryMsaidiziTaskDto {
  @ApiPropertyOptional({ enum: MsaidiziTaskStatus })
  @IsOptional()
  @IsEnum(MsaidiziTaskStatus)
  status?: MsaidiziTaskStatus;

  @ApiPropertyOptional({ enum: MsaidiziTaskMode })
  @IsOptional()
  @IsEnum(MsaidiziTaskMode)
  mode?: MsaidiziTaskMode;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}

export class QueryMsaidiziTaskEventsDto {
  @ApiPropertyOptional({ default: '0', description: 'Exclusive decimal event cursor' })
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/)
  @MaxLength(40)
  after: string = '0';

  @ApiPropertyOptional({ default: 100, minimum: 1, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit: number = 100;
}
