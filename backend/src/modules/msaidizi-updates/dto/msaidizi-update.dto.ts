import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateMsaidiziUpdateCandidateDto {
  @IsUUID()
  proposedByTaskId!: string;

  @IsUUID()
  sourceArtifactId!: string;

  @IsUUID()
  rollbackArtifactId!: string;

  @IsString()
  @Length(1, 160)
  name!: string;

  @IsString()
  @Length(1, 80)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/)
  version!: string;

  @IsString()
  @Length(1, 80)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/)
  rollbackVersion!: string;

  @IsString()
  @Length(1, 160)
  scope!: string;
}

export class SignedEvaluatorAttestationDto {
  @IsString()
  @Length(2, 65_536)
  claimsJson!: string;

  @IsString()
  @Matches(/^[A-Za-z0-9_-]{86}$/)
  signature!: string;
}

export class SubmitMsaidiziUpdateEvaluationDto {
  @ValidateNested()
  @Type(() => SignedEvaluatorAttestationDto)
  runner!: SignedEvaluatorAttestationDto;

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => SignedEvaluatorAttestationDto)
  reviews!: SignedEvaluatorAttestationDto[];
}

export class StartMsaidiziUpdateEvaluationRunDto {
  @IsUUID()
  leaseId!: string;
}

export class ReportMsaidiziUpdateEvaluationUsageDto {
  @IsUUID()
  leaseId!: string;

  @IsInt()
  @Min(0)
  @Max(57_600)
  cpuTimeSeconds!: number;

  @IsString()
  @Matches(/^(0|[1-9][0-9]{0,19})$/)
  bytesRead!: string;

  @IsString()
  @Matches(/^(0|[1-9][0-9]{0,19})$/)
  bytesWritten!: string;

  @IsString()
  @Matches(/^(0|[1-9][0-9]{0,19})$/)
  externalEgressBytes!: string;

  @IsInt()
  @Min(0)
  @Max(20)
  modelTurns!: number;

  @IsString()
  @Matches(/^(0|[1-9][0-9]{0,19})$/)
  modelInputTokens!: string;

  @IsString()
  @Matches(/^(0|[1-9][0-9]{0,19})$/)
  modelOutputTokens!: string;

  @IsString()
  @Matches(/^(0|[1-9][0-9]{0,19})$/)
  modelCostMicrousd!: string;
}

export class RolloutMsaidiziUpdateDto {
  @IsInt()
  @IsIn([0, 5, 25, 100])
  ring!: number;

  /** Optional explicit ring membership. If omitted the broker uses a stable
   * deterministic sample of active enrolled devices. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID(undefined, { each: true })
  deviceIds?: string[];

  /** Legacy-compatible ring-0 hint. It cannot authorize progression: the
   * active mandate and immutable deployment policy are always re-evaluated. */
  @IsOptional()
  @IsBoolean()
  automaticProgression?: boolean;
}

export class ReportMsaidiziUpdateHealthDto {
  @IsBoolean()
  healthy!: boolean;

  @IsString()
  @Length(1, 120)
  monitor!: string;

  @IsObject()
  metrics!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  reason?: string;
}

export enum MsaidiziUpdateStatusFilter {
  DRAFT = 'DRAFT',
  EVALUATING = 'EVALUATING',
  REJECTED = 'REJECTED',
  APPROVED = 'APPROVED',
  CANARY = 'CANARY',
  ACTIVE = 'ACTIVE',
  ROLLED_BACK = 'ROLLED_BACK',
  FAILED = 'FAILED',
}

export class QueryMsaidiziUpdateCandidateDto {
  @IsOptional()
  @IsEnum(MsaidiziUpdateStatusFilter)
  status?: MsaidiziUpdateStatusFilter;
}

export class PollMsaidiziUpdateDeploymentsDto {
  @IsUUID()
  deviceId!: string;
}

export class MsaidiziUpdateProgressDto {
  @IsUUID()
  deviceId!: string;

  @IsUUID()
  deploymentId!: string;

  @IsUUID()
  deliveryLeaseId!: string;

  @IsString()
  @Matches(/^[0-9a-fA-F]{64}$/)
  manifestSha256!: string;

  @IsIn(['APPLYING', 'HEALTH_CHECK'])
  status!: 'APPLYING' | 'HEALTH_CHECK';

  @IsString()
  @Matches(/^[0-9a-fA-F]{64}$/)
  journalHeadSha256!: string;
}

export class AckMsaidiziUpdateDeploymentDto {
  @IsUUID()
  deviceId!: string;

  @IsUUID()
  deploymentId!: string;

  @IsUUID()
  deliveryLeaseId!: string;

  @IsString()
  @Matches(/^[0-9a-fA-F]{64}$/)
  manifestSha256!: string;
}

export class MsaidiziUpdateResultDto {
  @IsUUID()
  deviceId!: string;

  @IsUUID()
  deploymentId!: string;

  @IsIn(['SUCCEEDED', 'ROLLED_BACK', 'FAILED', 'NEEDS_ATTENTION'])
  outcome!: 'SUCCEEDED' | 'ROLLED_BACK' | 'FAILED' | 'NEEDS_ATTENTION';

  @IsString()
  @Matches(/^[0-9a-fA-F]{64}$/)
  manifestSha256!: string;

  @IsString()
  @Matches(/^[0-9a-fA-F]{64}$/)
  journalHeadSha256!: string;

  @IsOptional()
  @IsString()
  @Matches(/^[0-9a-fA-F]{64}$/)
  activatedArtifactSha256?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  observedVersion?: string;

  @IsObject()
  health!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  reason?: string;
}
