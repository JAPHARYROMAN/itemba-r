import {
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { OfflineSyncDirection, OfflineSyncOperation } from '@prisma/client';

export class SyncRecordDto {
  @IsNotEmpty()
  @IsString()
  clientRecordId!: string;

  @IsNotEmpty()
  @IsString()
  entityType!: string;

  @IsEnum(OfflineSyncOperation)
  operation!: OfflineSyncOperation;

  payload!: Record<string, any>;

  @IsOptional()
  @IsDateString()
  clientUpdatedAt?: string;
}

export class CreateSyncBatchDto {
  @IsNotEmpty()
  @IsString()
  clientBatchId!: string;

  @IsOptional()
  @IsEnum(OfflineSyncDirection)
  syncDirection?: OfflineSyncDirection;

  @IsOptional()
  @IsString()
  deviceId?: string;

  @IsOptional()
  @IsString()
  companyId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SyncRecordDto)
  records!: SyncRecordDto[];
}
