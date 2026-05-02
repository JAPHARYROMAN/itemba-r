import { IsArray, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import {
  BorrowerLevel,
  CurrencyCode,
  LoanStatus,
  ObligationType,
  RepaymentFrequency,
  RiskLevel,
} from '@prisma/client';

export class CreateLoanDto {
  @IsOptional() @IsEnum(ObligationType) obligationType?: ObligationType;
  @IsOptional() @IsEnum(BorrowerLevel) borrowerLevel?: BorrowerLevel;
  @IsOptional() @IsString() companyId?: string;
  @IsOptional() @IsString() groupId?: string;
  @IsOptional() @IsString() loanReference?: string;
  @IsNotEmpty() @IsString() lenderName!: string;
  @IsOptional() @IsString() lenderType?: string;
  @IsOptional() @IsString() lenderContact?: string;
  @IsNotEmpty() @IsString() principalAmount!: string;
  @IsOptional() @IsEnum(CurrencyCode) currency?: CurrencyCode;
  @IsNotEmpty() @IsString() interestRate!: string;
  @IsNotEmpty() @IsString() disbursementDate!: string;
  @IsNotEmpty() @IsString() maturityDate!: string;
  @IsOptional() @IsEnum(RepaymentFrequency) repaymentFrequency?: RepaymentFrequency;
  @IsOptional() @IsString() repaymentAmount?: string;
  @IsNotEmpty() @IsString() outstandingBalance!: string;
  @IsOptional() @IsEnum(LoanStatus) status?: LoanStatus;
  @IsOptional() @IsEnum(RiskLevel) riskLevel?: RiskLevel;
  @IsOptional() @IsString() purpose?: string;
  @IsOptional() @IsString() collateralDescription?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) linkedAssetIds?: string[];
  @IsOptional() @IsString() guarantorName?: string;
  @IsOptional() @IsString() guarantorContact?: string;
  @IsOptional() @IsString() guaranteeDetails?: string;
  @IsOptional() @IsString() bankAccountId?: string;
  @IsOptional() @IsString() notes?: string;
}
