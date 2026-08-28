import { MsaidiziArtifactKind } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsObject, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class CreateMsaidiziArtifactDto {
  @IsUUID()
  taskId!: string;

  @IsOptional()
  @IsUUID()
  stepId?: string;

  @IsEnum(MsaidiziArtifactKind)
  kind!: MsaidiziArtifactKind;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 200)
  name!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 80)
  dataClass!: string;

  /**
   * Multipart form fields are strings. Accept an object in tests/internal use,
   * or a JSON object string at the HTTP boundary; arrays and scalars remain
   * invalid so provenance always has named, reviewable fields.
   */
  @Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  })
  @IsObject()
  provenance!: Record<string, unknown>;
}

export class QueryMsaidiziArtifactDto {
  @IsUUID()
  taskId!: string;

  @IsOptional()
  @IsUUID()
  stepId?: string;

  @IsOptional()
  @IsEnum(MsaidiziArtifactKind)
  kind?: MsaidiziArtifactKind;
}
