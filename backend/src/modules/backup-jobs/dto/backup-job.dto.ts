import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { BackupJobStatus, BackupSchedule, BackupStorageTarget, BackupType } from '@prisma/client';

export class QueryBackupJobDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;

  @IsOptional()
  @IsEnum(BackupType)
  backupType?: BackupType;

  @IsOptional()
  @IsEnum(BackupJobStatus)
  status?: BackupJobStatus;

  @IsOptional()
  @IsEnum(BackupSchedule)
  schedule?: BackupSchedule;
}

export class CreateBackupJobDto {
  @IsString()
  @MaxLength(160)
  name!: string;

  @IsEnum(BackupType)
  backupType!: BackupType;

  @IsOptional()
  @IsEnum(BackupSchedule)
  schedule?: BackupSchedule;

  @IsOptional()
  @IsObject()
  scheduleConfig?: Record<string, unknown>;

  @IsOptional()
  @IsEnum(BackupStorageTarget)
  storageTarget?: BackupStorageTarget;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  retentionDays?: number;

  @IsOptional()
  @IsEnum(BackupJobStatus)
  status?: BackupJobStatus;

  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsDateString()
  nextRunAt?: string | null;
}

export class UpdateBackupJobDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsEnum(BackupSchedule)
  schedule?: BackupSchedule;

  @IsOptional()
  @IsObject()
  scheduleConfig?: Record<string, unknown>;

  @IsOptional()
  @IsEnum(BackupStorageTarget)
  storageTarget?: BackupStorageTarget;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  retentionDays?: number;

  @IsOptional()
  @IsEnum(BackupJobStatus)
  status?: BackupJobStatus;

  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsDateString()
  nextRunAt?: string | null;
}
