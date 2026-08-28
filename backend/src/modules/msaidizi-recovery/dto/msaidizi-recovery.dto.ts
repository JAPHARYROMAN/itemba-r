import { IsIn, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';

export class RequestMsaidiziRecoveryDto {
  @IsUUID()
  hostActionId!: string;

  /** Required for administrative state recovery. Quarantine recovery has one
   * canonical expected state (absent), so the broker derives it instead. */
  @IsOptional()
  @IsString()
  @Matches(/^[0-9a-fA-F]{64}$/)
  expectedCurrentStateSha256?: string;

  @IsString()
  @Length(1, 220)
  confirmationPhrase!: string;
}

export class QueryMsaidiziRecoveryDto {
  @IsOptional()
  @IsIn(['QUEUED', 'DISPATCHED', 'RECOVERING', 'SUCCEEDED', 'FAILED', 'NEEDS_ATTENTION'])
  status?: 'QUEUED' | 'DISPATCHED' | 'RECOVERING' | 'SUCCEEDED' | 'FAILED' | 'NEEDS_ATTENTION';
}

export class PollMsaidiziRecoveryDto {
  @IsUUID()
  deviceId!: string;
}

export class MsaidiziRecoveryProgressDto {
  @IsUUID()
  deviceId!: string;

  @IsUUID()
  recoveryId!: string;

  @IsString()
  @Matches(/^[0-9a-fA-F]{64}$/)
  journalHeadSha256!: string;
}

export class MsaidiziRecoveryResultDto {
  @IsUUID()
  deviceId!: string;

  @IsUUID()
  recoveryId!: string;

  @IsIn(['SUCCEEDED', 'FAILED', 'NEEDS_ATTENTION'])
  outcome!: 'SUCCEEDED' | 'FAILED' | 'NEEDS_ATTENTION';

  @IsString()
  @Matches(/^[0-9a-fA-F]{64}$/)
  manifestSha256!: string;

  @IsString()
  @Matches(/^[0-9a-fA-F]{64}$/)
  journalHeadSha256!: string;

  @IsOptional()
  @IsString()
  @Matches(/^[0-9a-fA-F]{64}$/)
  restoredStateSha256?: string;

  @IsOptional()
  @IsString()
  @Length(1, 160)
  reason?: string;
}
