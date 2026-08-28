import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { IsPositiveInt64Decimal } from './positive-int64-decimal.validator';

const SHA256_HEX = /^[0-9a-fA-F]{64}$/;
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const LEASE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const POSITIVE_DECIMAL_STRING = /^[1-9][0-9]*$/;
const COMPACT_JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const JOURNAL_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
export const MAX_JOURNAL_RECONCILIATION_ENTRIES = 128;

export class CreatePairingCodeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;
}

export type MsaidiziSupervisorEnrollmentRole = 'UPDATE' | 'RECOVERY';

export class CreateSupervisorEnrollmentCodeDto {
  @IsIn(['UPDATE', 'RECOVERY'])
  role!: MsaidiziSupervisorEnrollmentRole;
}

export class CompleteSupervisorEnrollmentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  deviceId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  enrollmentId!: string;

  @IsIn(['UPDATE', 'RECOVERY'])
  role!: MsaidiziSupervisorEnrollmentRole;

  @IsString()
  @MinLength(16)
  @MaxLength(64)
  enrollmentCode!: string;
}

export class CapabilityDescriptorDto {
  @IsString()
  @Matches(SAFE_IDENTIFIER)
  id!: string;

  @IsString()
  @Matches(SAFE_IDENTIFIER)
  version!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  displayName!: string;

  @IsString()
  @MaxLength(1_000)
  description!: string;

  @IsIn([
    'Public',
    'Internal',
    'Confidential',
    'Restricted',
    'Credential',
    'Biometric',
    0,
    1,
    2,
    3,
    4,
    5,
  ])
  dataClass!: string | number;

  @IsIn([
    'Observe',
    'LocalRead',
    'LocalWrite',
    'ExternalWrite',
    'Financial',
    'Administrative',
    'Irreversible',
    0,
    1,
    2,
    3,
    4,
    5,
    6,
  ])
  effect!: string | number;

  @IsIn([
    'None',
    'ActiveUser',
    'SignedMandate',
    'OneShotApproval',
    'EmergencyOperator',
    0,
    1,
    2,
    3,
    4,
  ])
  consent!: string | number;

  @IsIn([
    'NotApplicable',
    'IdempotentReplay',
    'Snapshot',
    'Quarantine',
    'CompensatingAction',
    'Irreversible',
    0,
    1,
    2,
    3,
    4,
    5,
  ])
  recovery!: string | number;

  @IsIn(['StandardUser', 'ElevatedUser', 'LocalSystem', 0, 1, 2])
  requiredPrivilege!: string | number;

  @IsIn(['NotApplicable', 'Supported', 'Required', 0, 1, 2])
  idempotency!: string | number;

  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  supportedOperatingSystems!: string[];

  @IsObject()
  argumentsSchema!: Record<string, unknown>;

  @IsObject()
  resultSchema!: Record<string, unknown>;

  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  provenanceOutputs!: string[];

  @IsBoolean()
  @IsOptional()
  touchesTrustedRoot: boolean = false;
}

export class CapabilityManifestSnapshotDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  deviceId!: string;

  @IsInt()
  @Min(1)
  @Max(3)
  @IsOptional()
  commandProtocolVersion?: number;

  @IsString()
  @Matches(SHA256_HEX)
  manifestSha256!: string;

  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => CapabilityDescriptorDto)
  capabilities!: CapabilityDescriptorDto[];

  @IsISO8601({ strict: true })
  generatedAt!: string;
}

export class CompletePairingDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  deviceId!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(32)
  pairingCode!: string;

  @IsString()
  @IsIn(['windows'])
  platform!: string;

  @IsString()
  @MaxLength(120)
  @IsOptional()
  osVersion?: string;

  @IsString()
  @MaxLength(40)
  @IsOptional()
  architecture?: string;

  @ValidateNested()
  @Type(() => CapabilityManifestSnapshotDto)
  capabilityManifest!: CapabilityManifestSnapshotDto;
}

export class PollDeviceCommandsDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  deviceId!: string;

  @IsInt()
  @Min(1)
  @Max(10)
  @IsOptional()
  maxCommands: number = 5;
}

export class CompanionHeartbeatDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  deviceId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  component!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  componentVersion!: string;

  @IsBoolean()
  executionEnabled!: boolean;

  @IsBoolean()
  killSwitchEngaged!: boolean;

  @IsBoolean()
  centralLedgerConnected!: boolean;

  @IsInt()
  @Min(0)
  @Max(1_000)
  runningActionCount!: number;

  @IsInt()
  @Min(0)
  journalSequence!: number;

  @IsString()
  @Matches(SHA256_HEX)
  journalHeadHash!: string;

  @IsString()
  @Matches(SHA256_HEX)
  capabilityManifestSha256!: string;

  @IsISO8601({ strict: true })
  sentAt!: string;
}

/** Digest-only local record. Persisted payload JSON is deliberately absent. */
export class DeviceJournalRecordDto {
  @IsInt()
  @IsIn([1, 2])
  hashVersion!: number;

  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  sequence!: number;

  @IsISO8601({ strict: true })
  occurredAt!: string;

  @IsIn([
    'Prepared',
    'Completed',
    'Rejected',
    'Cancelled',
    'Failed',
    'NeedsAttention',
    'RecoveryPrepared',
    'ActionFenced',
    'ChainUpgraded',
  ])
  kind!: string;

  @IsString()
  @Matches(JOURNAL_IDENTIFIER)
  actionId!: string;

  @IsString()
  @Matches(JOURNAL_IDENTIFIER)
  idempotencyKey!: string;

  @IsString()
  @Matches(SHA256_HEX)
  previousHash!: string;

  @IsString()
  @Matches(SHA256_HEX)
  payloadSha256!: string;

  @IsString()
  @Matches(SHA256_HEX)
  entryHash!: string;
}

export class DeviceJournalReconciliationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  deviceId!: string;

  @IsInt()
  @Min(0)
  @Max(2_147_483_647)
  startingPreviousSequence!: number;

  @IsString()
  @Matches(SHA256_HEX)
  startingPreviousHash!: string;

  @IsArray()
  @ArrayMaxSize(MAX_JOURNAL_RECONCILIATION_ENTRIES)
  @ValidateNested({ each: true })
  @Type(() => DeviceJournalRecordDto)
  entries!: DeviceJournalRecordDto[];

  @IsInt()
  @Min(0)
  @Max(2_147_483_647)
  finalSequence!: number;

  @IsString()
  @Matches(SHA256_HEX)
  finalHash!: string;

  @IsInt()
  @Min(0)
  @Max(2_147_483_647)
  localHeadSequence!: number;

  @IsString()
  @Matches(SHA256_HEX)
  localHeadHash!: string;
}

export class DeviceJournalHeadDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  deviceId!: string;
}

/** Protocol-v3 receipt for a durable local revocation tombstone. */
export class ActionFencedReceiptDto {
  @IsString()
  @Matches(SAFE_IDENTIFIER)
  fenceId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  deviceId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  actionId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  taskId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  stepId!: string;

  @IsString()
  @Matches(LEASE_IDENTIFIER)
  oldLeaseId!: string;

  @IsString()
  @MaxLength(19)
  @Matches(POSITIVE_DECIMAL_STRING)
  @IsPositiveInt64Decimal()
  oldFencingToken!: string;

  @IsString()
  @Matches(SHA256_HEX)
  oldActionTokenSha256!: string;

  @IsInt()
  @Min(1)
  @Max(3)
  fenceDispatchCount!: number;

  @IsString()
  @MinLength(64)
  @MaxLength(8_192)
  @Matches(COMPACT_JWT)
  compactToken!: string;

  @IsString()
  @Matches(SHA256_HEX)
  fenceTokenSha256!: string;

  @IsIn(['NoPrepared'])
  outcome!: 'NoPrepared';

  @IsInt()
  @Min(0)
  journalPreviousSequence!: number;

  @IsString()
  @Matches(SHA256_HEX)
  journalPreviousHash!: string;

  @IsInt()
  @Min(1)
  tombstoneSequence!: number;

  @IsString()
  @Matches(SHA256_HEX)
  tombstonePreviousHash!: string;

  @IsString()
  @Matches(SHA256_HEX)
  tombstoneEntryHash!: string;

  @IsISO8601({ strict: true })
  recordedAt!: string;
}

export class ActionProgressDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  actionId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  taskId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  stepId!: string;

  @IsString()
  @Matches(LEASE_IDENTIFIER)
  leaseId!: string;

  @IsString()
  @MaxLength(19)
  @Matches(POSITIVE_DECIMAL_STRING)
  @IsPositiveInt64Decimal()
  fencingToken!: string;

  @IsISO8601({ strict: true })
  leaseExpiresAt!: string;

  /** Exact signed ActionRequest generation being acknowledged. */
  @IsInt()
  @Min(1)
  @Max(3)
  dispatchCount!: number;

  @IsIn([
    'Accepted',
    'Started',
    'Cancelling',
    'Completed',
    'Failed',
    'Cancelled',
    'NeedsAttention',
    'Rejected',
    0,
    1,
    2,
    3,
    4,
    5,
    6,
    7,
  ])
  state!: string | number;

  @IsInt()
  @Min(0)
  @Max(100)
  percent!: number;

  @IsString()
  @Matches(SAFE_IDENTIFIER)
  messageCode!: string;

  @IsISO8601({ strict: true })
  occurredAt!: string;

  /** Exact locally durable Prepared record. Required as a complete tuple for Started. */
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  @IsOptional()
  journalPrepareSequence?: number;

  @IsString()
  @Matches(SHA256_HEX)
  @IsOptional()
  journalPreparePreviousHash?: string;

  @IsString()
  @Matches(SHA256_HEX)
  @IsOptional()
  journalPrepareEntryHash?: string;
}

export class DataProvenanceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  sourceType!: string;

  @IsString()
  @Matches(SHA256_HEX)
  sourceIdentifierHash!: string;

  @IsString()
  @Matches(SHA256_HEX)
  contentSha256!: string;

  @IsIn(['TrustedSystem', 'AuthenticatedRemote', 'UserSupplied', 'UntrustedContent', 0, 1, 2, 3])
  trust!: string | number;

  @IsISO8601({ strict: true })
  observedAt!: string;
}

export class ActionResultDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  actionId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  taskId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  stepId!: string;

  @IsString()
  @Matches(LEASE_IDENTIFIER)
  leaseId!: string;

  @IsString()
  @MaxLength(19)
  @Matches(POSITIVE_DECIMAL_STRING)
  @IsPositiveInt64Decimal()
  fencingToken!: string;

  @IsISO8601({ strict: true })
  leaseExpiresAt!: string;

  /** SHA-256 of the exact compact action token for this dispatch generation. */
  @IsString()
  @Matches(SHA256_HEX)
  actionTokenSha256!: string;

  @IsIn([
    'Completed',
    'Rejected',
    'Cancelled',
    'Failed',
    'NeedsAttention',
    'AlreadyRunning',
    0,
    1,
    2,
    3,
    4,
    5,
  ])
  outcome!: string | number;

  @IsString()
  @MaxLength(1_048_576)
  @IsOptional()
  outputJson?: string | null;

  @IsString()
  @Matches(SHA256_HEX)
  @IsOptional()
  outputSha256?: string | null;

  @IsBoolean()
  mutationCommitted!: boolean;

  @IsBoolean()
  outcomeUncertain!: boolean;

  @IsBoolean()
  isIdempotentReplay!: boolean;

  @IsString()
  @Matches(SAFE_IDENTIFIER)
  @IsOptional()
  errorCode?: string | null;

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => DataProvenanceDto)
  provenance!: DataProvenanceDto[];

  @IsInt()
  @Min(1)
  @IsOptional()
  journalPrepareSequence?: number | null;

  @IsString()
  @Matches(SHA256_HEX)
  @IsOptional()
  journalPrepareEntryHash?: string | null;

  @IsString()
  @Matches(SHA256_HEX)
  @IsOptional()
  journalPreparePreviousHash?: string | null;

  @IsInt()
  @Min(1)
  @IsOptional()
  journalRecoveryPreparedSequence?: number | null;

  @IsString()
  @Matches(SHA256_HEX)
  @IsOptional()
  journalRecoveryPreparedEntryHash?: string | null;

  @IsString()
  @Matches(SHA256_HEX)
  @IsOptional()
  journalRecoveryPreparedPreviousHash?: string | null;

  @IsInt()
  @Min(1)
  @IsOptional()
  journalSequence?: number | null;

  @IsString()
  @Matches(SHA256_HEX)
  @IsOptional()
  journalEntryHash?: string | null;

  @IsString()
  @Matches(SHA256_HEX)
  @IsOptional()
  journalPreviousHash?: string | null;

  @IsString()
  @Matches(SHA256_HEX)
  @IsOptional()
  preStateSha256?: string | null;

  @IsString()
  @Matches(SHA256_HEX)
  @IsOptional()
  recoveryProvenanceSha256?: string | null;

  @IsString()
  @Matches(SHA256_HEX)
  @IsOptional()
  recoveryHandleSha256?: string | null;

  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  localBytesRead!: number;

  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  localBytesWritten!: number;

  /**
   * Conservatively measured application-payload bytes emitted by the host
   * capability to a non-Itemba destination.
   */
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  externalEgressBytes!: number;

  /**
   * Immutable prepaid upper bound for every permitted delivery of this
   * complete serialized result to the broker, including retries.
   */
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  brokerExternalEgressBytes!: number;

  @IsInt()
  @Min(1)
  @Max(3)
  brokerMaxDeliverySessions!: number;

  @IsInt()
  @Min(1)
  @Max(3)
  brokerMaxRequestAttemptsPerSession!: number;

  @IsInt()
  @Min(1)
  @Max(16_777_216)
  brokerSerializedResultUpperBoundBytes!: number;

  /**
   * Conservative egress charge used when a device-side failure prevents exact
   * measurement. It is distinct from capability and broker measurements.
   */
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  uncertainExternalEgressBytes!: number;

  /** Strict signed supervisor authorization + receipt bundle for metered effects. */
  @IsObject()
  @IsOptional()
  egressEvidence?: Record<string, unknown> | null;
}
