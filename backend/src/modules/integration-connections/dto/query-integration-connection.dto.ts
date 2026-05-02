import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import {
  IntegrationConnectionEnvironment,
  IntegrationConnectionStatus,
} from '@prisma/client';

export class QueryIntegrationConnectionDto {
  @IsOptional()
  @IsString()
  companyId?: string;

  @IsOptional()
  @IsString()
  providerId?: string;

  @IsOptional()
  @IsEnum(IntegrationConnectionStatus)
  status?: IntegrationConnectionStatus;

  @IsOptional()
  @IsEnum(IntegrationConnectionEnvironment)
  environment?: IntegrationConnectionEnvironment;

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
