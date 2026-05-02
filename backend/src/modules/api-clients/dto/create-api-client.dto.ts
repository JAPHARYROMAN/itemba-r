import {
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ApiClientStatus, ApiClientType } from '@prisma/client';

export class CreateApiClientDto {
  @IsNotEmpty()
  @IsString()
  clientCode!: string;

  @IsOptional()
  @IsString()
  companyId?: string;

  @IsNotEmpty()
  @IsString()
  name!: string;

  @IsOptional()
  @IsEnum(ApiClientType)
  clientType?: ApiClientType;

  @IsOptional()
  @IsEnum(ApiClientStatus)
  status?: ApiClientStatus;

  @IsOptional()
  @IsString()
  description?: string;

  @IsArray()
  allowedScopes!: string[];

  @IsOptional()
  @IsArray()
  allowedIpAddresses?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  rateLimitPerMinute?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  rateLimitPerDay?: number;
}
