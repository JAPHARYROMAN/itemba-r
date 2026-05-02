import { IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { IntegrationProviderStatus, IntegrationProviderType } from '@prisma/client';

export class CreateIntegrationProviderDto {
  @IsNotEmpty()
  @IsString()
  providerCode!: string;

  @IsNotEmpty()
  @IsString()
  name!: string;

  @IsEnum(IntegrationProviderType)
  providerType!: IntegrationProviderType;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  baseUrl?: string;

  @IsOptional()
  @IsString()
  documentationUrl?: string;

  @IsOptional()
  @IsEnum(IntegrationProviderStatus)
  status?: IntegrationProviderStatus;

  @IsOptional()
  @IsBoolean()
  supportsWebhooks?: boolean;

  @IsOptional()
  @IsBoolean()
  supportsSandbox?: boolean;
}
