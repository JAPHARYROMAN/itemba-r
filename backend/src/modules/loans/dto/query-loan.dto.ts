import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { BorrowerLevel, LoanStatus, ObligationType, RiskLevel } from '@prisma/client';

export class QueryLoanDto {
  @IsOptional() @IsString() companyId?: string;
  @IsOptional() @IsString() divisionId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() groupId?: string;
  @IsOptional() @IsEnum(LoanStatus) status?: LoanStatus;
  @IsOptional() @IsEnum(ObligationType) obligationType?: ObligationType;
  @IsOptional() @IsEnum(BorrowerLevel) borrowerLevel?: BorrowerLevel;
  @IsOptional() @IsEnum(RiskLevel) riskLevel?: RiskLevel;
  @IsOptional() @IsString() search?: string;
  /** ISO date string — return loans maturing on or before this date */
  @IsOptional() @IsString() maturityBefore?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5000) limit?: number = 20;
}
