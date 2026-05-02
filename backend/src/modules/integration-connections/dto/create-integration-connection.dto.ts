import {
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';
import {
  IntegrationConnectionEnvironment,
  IntegrationConnectionStatus,
} from '@prisma/client';

export class CreateIntegrationConnectionDto {
  @IsNotEmpty()
  @IsString()
  connectionCode!: string;

  @IsOptional()
  @IsString()
  companyId?: string;

  @IsOptional()
  @IsString()
  divisionId?: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsString()
  licensedBusinessUnitId?: string;

  @IsNotEmpty()
  @IsString()
  providerId!: string;

  @IsNotEmpty()
  @IsString()
  connectionName!: string;

  @IsOptional()
  @IsEnum(IntegrationConnectionEnvironment)
  environment?: IntegrationConnectionEnvironment;

  @IsOptional()
  @IsEnum(IntegrationConnectionStatus)
  status?: IntegrationConnectionStatus;

  @IsOptional()
  @IsObject()
  publicConfig?: Record<string, any>;

  /** Credentials to encrypt — never returned to the frontend */
  @IsOptional()
  @IsObject()
  credentials?: Record<string, any>;

  /** Private config to encrypt — never returned to the frontend */
  @IsOptional()
  @IsObject()
  privateConfig?: Record<string, any>;
}
