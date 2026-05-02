import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { CurrencyCode, DebtStatus, RiskLevel } from '@prisma/client';

export class CreateDebtDto {
  @IsNotEmpty() @IsString() companyId!: string;
  @IsNotEmpty() @IsString() creditorName!: string;
  @IsOptional() @IsString() creditorContact?: string;
  @IsNotEmpty() @IsString() amount!: string;
  @IsOptional() @IsString() amountPaid?: string;
  @IsOptional() @IsEnum(CurrencyCode) currency?: CurrencyCode;
  @IsOptional() @IsString() dueDate?: string;
  @IsNotEmpty() @IsString() description!: string;
  @IsOptional() @IsString() invoiceNumber?: string;
  @IsOptional() @IsEnum(DebtStatus) status?: DebtStatus;
  @IsOptional() @IsEnum(RiskLevel) riskLevel?: RiskLevel;
  @IsOptional() @IsString() notes?: string;
}
