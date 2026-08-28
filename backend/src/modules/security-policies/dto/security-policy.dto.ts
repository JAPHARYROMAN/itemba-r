import { SecurityPolicyType } from '@prisma/client';
import { IsBoolean, IsDateString, IsEnum, IsObject, IsOptional, IsString } from 'class-validator';

export class CreateSecurityPolicyDto {
  @IsOptional()
  @IsString()
  policyCode?: string;

  @IsString()
  name!: string;

  @IsEnum(SecurityPolicyType)
  policyType!: SecurityPolicyType;

  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  companyId?: string;
}

export class UpdateSecurityPolicyDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(SecurityPolicyType)
  policyType?: SecurityPolicyType;

  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  approvedById?: string;

  @IsOptional()
  @IsDateString()
  approvedAt?: string;
}
