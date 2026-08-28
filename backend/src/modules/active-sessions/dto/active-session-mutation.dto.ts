import { ActiveSessionType } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateActiveSessionDto {
  @IsUUID()
  userId!: string;

  @IsOptional()
  @IsUUID()
  companyId?: string;

  @IsOptional()
  @IsString()
  deviceId?: string;

  @IsOptional()
  @IsEnum(ActiveSessionType)
  sessionType?: ActiveSessionType;

  @IsOptional()
  @IsString()
  ipAddress?: string;

  @IsOptional()
  @IsString()
  userAgent?: string;

  @IsOptional()
  @IsString()
  deviceSummary?: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class RevokeActiveSessionDto {
  @IsOptional()
  @IsString()
  revokeReason?: string;
}
