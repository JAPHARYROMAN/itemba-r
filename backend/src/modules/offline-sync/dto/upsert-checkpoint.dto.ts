import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class UpsertCheckpointDto {
  @IsNotEmpty()
  @IsString()
  entityType!: string;

  @IsNotEmpty()
  lastSyncAt!: string;

  @IsOptional()
  @IsString()
  lastServerCursor?: string;

  @IsOptional()
  @IsString()
  deviceId?: string;

  @IsOptional()
  @IsString()
  companyId?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
