import { LoanPaymentMethod, LoanRepaymentStatus } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
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

  @IsNumber()
  principalAmount!: number;

  @IsOptional()
  @IsNumber()
  interestAmount?: number;

  @IsOptional()
  @IsNumber()
  feeAmount?: number;

  @IsNumber()
  totalAmount!: number;

  @IsOptional()
  @IsNumber()
  paidAmount?: number;

  @IsNumber()
  outstandingAmount!: number;

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
  @IsNumber()
  amount!: number;

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
