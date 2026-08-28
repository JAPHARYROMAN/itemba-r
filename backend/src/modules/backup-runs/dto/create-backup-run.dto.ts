import { BackupType } from '@prisma/client';
import { IsEnum, IsObject, IsOptional, IsUUID } from 'class-validator';

export class CreateBackupRunDto {
  @IsOptional()
  @IsUUID()
  backupJobId?: string;

  @IsOptional()
  @IsEnum(BackupType)
  backupType?: BackupType;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
