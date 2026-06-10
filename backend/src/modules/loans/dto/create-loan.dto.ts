import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';
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
  @IsOptional() @IsString() divisionId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() groupId?: string;
  @IsOptional() @IsString() loanReference?: string;
  @IsNotEmpty() @IsString() lenderName!: string;
  @IsOptional() @IsString() lenderType?: string;
  @IsOptional() @IsString() lenderContact?: string;
  @IsNotEmpty()
  @IsNumberString()
  @Matches(/^\d+(\.\d+)?$/, { message: 'principalAmount must be a non-negative number' })
  principalAmount!: string;
  @IsOptional() @IsEnum(CurrencyCode) currency?: CurrencyCode;
  @IsNotEmpty()
  @IsNumberString()
  @Matches(/^\d+(\.\d+)?$/, { message: 'interestRate must be a non-negative number' })
  interestRate!: string;
  @IsNotEmpty() @IsString() disbursementDate!: string;
  @IsNotEmpty() @IsString() maturityDate!: string;
  @IsOptional() @IsEnum(RepaymentFrequency) repaymentFrequency?: RepaymentFrequency;
  @IsOptional()
  @IsNumberString()
  @Matches(/^\d+(\.\d+)?$/, { message: 'repaymentAmount must be a non-negative number' })
  repaymentAmount?: string;
  @IsNotEmpty()
  @IsNumberString()
  @Matches(/^\d+(\.\d+)?$/, { message: 'outstandingBalance must be a non-negative number' })
  outstandingBalance!: string;
  // status is server-controlled at creation (forced to ACTIVE in the service);
  // any client-supplied value is ignored. Use the mark-loan-status endpoint to
  // change the status afterwards.
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
