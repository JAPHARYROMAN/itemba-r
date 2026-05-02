import {
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';
import { IntegrationMappingStatus } from '@prisma/client';

export class CreateIntegrationMappingDto {
  @IsNotEmpty()
  @IsString()
  mappingCode!: string;

  @IsOptional()
  @IsString()
  companyId?: string;

  @IsOptional()
  @IsString()
  providerId?: string;

  @IsOptional()
  @IsString()
  connectionId?: string;

  @IsNotEmpty()
  @IsString()
  internalEntityType!: string;

  @IsNotEmpty()
  @IsString()
  externalEntityType!: string;

  @IsOptional()
  @IsString()
  internalEntityId?: string;

  @IsNotEmpty()
  @IsString()
  externalEntityId!: string;

  @IsOptional()
  @IsObject()
  mappingData?: Record<string, any>;

  @IsOptional()
  @IsEnum(IntegrationMappingStatus)
  status?: IntegrationMappingStatus;
}
