import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import {
  IntegrationEventDirection,
  IntegrationEventStatus,
  IntegrationEventType,
} from '@prisma/client';

export class QueryIntegrationEventDto {
  @IsOptional()
  @IsString()
  companyId?: string;

  @IsOptional()
  @IsString()
  providerId?: string;

  @IsOptional()
  @IsString()
  connectionId?: string;

  @IsOptional()
  @IsEnum(IntegrationEventType)
  eventType?: IntegrationEventType;

  @IsOptional()
  @IsEnum(IntegrationEventStatus)
  status?: IntegrationEventStatus;

  @IsOptional()
  @IsEnum(IntegrationEventDirection)
  direction?: IntegrationEventDirection;

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
}
