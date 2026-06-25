import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ContractStatus, ContractType, ContractOwnershipLevel, RiskLevel } from '@prisma/client';

export class QueryContractDto {
  @IsOptional() @IsString() companyId?: string;
  @IsOptional() @IsString() groupId?: string;
  @IsOptional() @IsEnum(ContractOwnershipLevel) owningLevel?: ContractOwnershipLevel;
  @IsOptional() @IsEnum(ContractStatus) status?: ContractStatus;
  @IsOptional() @IsEnum(ContractType) contractType?: ContractType;
  @IsOptional() @IsEnum(RiskLevel) riskLevel?: RiskLevel;
  @IsOptional() @IsString() expiringBefore?: string;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5000) limit?: number = 20;
}
