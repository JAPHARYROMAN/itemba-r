import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { IntegrationProviderStatus, IntegrationProviderType } from '@prisma/client';

export class QueryIntegrationProviderDto {
  @IsOptional()
  @IsEnum(IntegrationProviderType)
  providerType?: IntegrationProviderType;

  @IsOptional()
  @IsEnum(IntegrationProviderStatus)
  status?: IntegrationProviderStatus;

  @IsOptional()
  @IsString()
  search?: string;

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
