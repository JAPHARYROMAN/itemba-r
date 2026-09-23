import { Transform } from 'class-transformer';
import { LoanPaymentMethod, LoanRepaymentStatus } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';

export class CreateLoanRepaymentScheduleDto {
  @IsOptional()
  @IsUUID()
  loanDebtId?: string;

  @IsOptional()
  @IsUUID()
  loanId?: string;

  @IsString()
  repaymentScheduleNumber!: string;

  @IsInt()
  installmentNumber!: number;

  @IsDateString()
  dueDate!: string;

  @Transform(({ value }) => String(value))
  @Matches(/^\d+(\.\d{1,2})?$/)
  principalAmount!: string;

  @IsOptional()
  @Transform(({ value }) => String(value))
  @Matches(/^\d+(\.\d{1,2})?$/)
  interestAmount?: string;

  @IsOptional()
  @Transform(({ value }) => String(value))
  @Matches(/^\d+(\.\d{1,2})?$/)
  feeAmount?: string;

  @IsOptional()
  @IsNumber()
  totalAmount?: number;

  @IsOptional()
  @IsNumber()
  paidAmount?: number;

  @IsOptional()
  @IsNumber()
  outstandingAmount?: number;

  @IsOptional()
  @IsEnum(LoanRepaymentStatus)
  status?: LoanRepaymentStatus;

  @IsOptional()
  @IsUUID()
  payableId?: string;

  @IsOptional()
  @IsUUID()
  journalEntryId?: string;
}

export class RecordLoanRepaymentDto {
  @Matches(/^[a-f0-9]{64}$/) allocationFingerprint!: string;
  @IsUUID() requestId!: string;
  @IsUUID() cashDeskAccountId!: string;
  @IsOptional() @IsString() interestAccountId?: string;
  @IsOptional() @IsString() feeAccountId?: string;
  @Transform(({ value }) => String(value))
  @Matches(/^\d+(\.\d{1,2})?$/)
  amount!: string;

  @IsOptional()
  @IsDateString()
  paymentDate?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsEnum(LoanPaymentMethod)
  paymentMethod?: LoanPaymentMethod;

  @IsOptional()
  @IsUUID()
  cashAccountId?: string;

  @IsOptional()
  @IsString()
  reference?: string;
}
