import { IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ContractStatus, ContractType, ContractOwnershipLevel, CurrencyCode, RiskLevel } from '@prisma/client';

export class CreateContractDto {
  @IsNotEmpty() @IsEnum(ContractOwnershipLevel) owningLevel!: ContractOwnershipLevel;
  @IsOptional() @IsString() companyId?: string;
  @IsOptional() @IsString() groupId?: string;
  @IsOptional() @IsString() divisionId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsNotEmpty() @IsString() title!: string;
  @IsNotEmpty() @IsEnum(ContractType) contractType!: ContractType;
  @IsOptional() @IsString() contractNumber?: string;
  @IsNotEmpty() @IsString() counterpartyName!: string;
  @IsOptional() @IsString() counterpartyContact?: string;
  @IsOptional() @IsString() counterpartyAddress?: string;
  @IsNotEmpty() @IsString() startDate!: string;
  @IsOptional() @IsString() endDate?: string;
  @IsOptional() @IsString() renewalDate?: string;
  @IsOptional() @IsString() renewalNoticeDate?: string;
  @IsOptional() @IsBoolean() autoRenews?: boolean;
  @IsOptional() @IsString() value?: string;
  @IsOptional() @IsEnum(CurrencyCode) currency?: CurrencyCode;
  @IsOptional() @IsString() paymentTerms?: string;
  @IsOptional() @IsString() obligations?: string;
  @IsOptional() @IsEnum(ContractStatus) status?: ContractStatus;
  @IsOptional() @IsEnum(RiskLevel) riskLevel?: RiskLevel;
  @IsOptional() @IsBoolean() isSensitive?: boolean;
  @IsOptional() @IsString() responsiblePersonId?: string;
  @IsOptional() @IsString() signatoryUserId?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() notes?: string;
}
