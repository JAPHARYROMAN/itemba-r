import { SecurityEventSeverity, SecurityEventStatus, SecurityEventType } from '@prisma/client';
import { IsEnum, IsObject, IsOptional, IsString } from 'class-validator';

export class CreateSecurityEventDto {
  @IsOptional()
  @IsEnum(SecurityEventType)
  eventType?: SecurityEventType;

  @IsOptional()
  @IsEnum(SecurityEventSeverity)
  severity?: SecurityEventSeverity;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  ipAddress?: string;

  @IsOptional()
  @IsString()
  userAgent?: string;

  @IsOptional()
  @IsString()
  locationSummary?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsEnum(SecurityEventStatus)
  status?: SecurityEventStatus;

  @IsOptional()
  @IsString()
  companyId?: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  apiClientId?: string;

  @IsOptional()
  @IsString()
  deviceId?: string;
}
