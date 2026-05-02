import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { IntegrationMappingStatus } from '@prisma/client';

export class QueryIntegrationMappingDto {
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
  @IsString()
  internalEntityType?: string;

  @IsOptional()
  @IsString()
  externalEntityType?: string;

  @IsOptional()
  @IsEnum(IntegrationMappingStatus)
  status?: IntegrationMappingStatus;

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
