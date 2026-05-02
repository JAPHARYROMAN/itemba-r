import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { DebtStatus, RiskLevel } from '@prisma/client';

export class QueryDebtDto {
  @IsOptional() @IsString() companyId?: string;
  @IsOptional() @IsEnum(DebtStatus) status?: DebtStatus;
  @IsOptional() @IsEnum(RiskLevel) riskLevel?: RiskLevel;
  @IsOptional() @IsString() search?: string;
  /** ISO date string — return debts due on or before this date */
  @IsOptional() @IsString() dueBefore?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) limit?: number = 20;
}
