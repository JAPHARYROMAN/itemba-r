import { IsInt, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

const SHA256 = /^[0-9a-f]{64}$/;

export class FetchMsaidiziAuditSegmentDto {
  @IsString()
  @Matches(/^(0|[1-9][0-9]{0,18})$/)
  afterCursor!: string;

  @IsString()
  @Matches(SHA256)
  afterEventHash!: string;

  @IsString()
  @Matches(SHA256)
  lastCheckpointSha256!: string;

  @IsInt()
  @Min(1)
  @Max(1_000)
  limit!: number;
}

export class SubmitMsaidiziAuditCheckpointDto {
  @IsString()
  @MaxLength(8_192)
  manifestJson!: string;

  @IsString()
  @Matches(SHA256)
  manifestSha256!: string;

  @IsString()
  @Matches(/^[A-Za-z0-9_-]{86}$/)
  signature!: string;
}
