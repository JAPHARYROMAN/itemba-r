import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const CASH_EXPENSE_CATEGORIES = [
  'RENT',
  'UTILITIES',
  'TRANSPORT',
  'FUEL',
  'MEALS',
  'OFFICE',
  'MAINTENANCE',
  'STAFF',
  'FEES',
  'TAXES',
  'OTHER',
] as const;

export class CashQuery {
  @IsOptional() @IsUUID() companyId?: string;
  @IsOptional() @IsUUID() divisionId?: string;
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsUUID() accountId?: string;
  @IsOptional() @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) date?: string;
  @IsOptional()
  @IsIn([
    'PAYROLL_PAYMENT',
    'SALE_RECEIPT',
    'SALES_INCOME',
    'DAILY_SALES',
    'OTHER_IN',
    'EXPENSE',
    'TRANSFER',
    'LOAN',
    'LOAN_REPAYMENT',
    'SUPPLIER_PAYMENT',
    'OPENING',
    'REVERSAL',
    'BORROWING',
    'DEBT_REPAYMENT',
  ])
  kind?: string;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
}
export class CashAccountDto {
  @IsUUID() requestId!: string;
  @IsUUID() companyId!: string;
  @IsUUID() divisionId!: string;
  @IsUUID() branchId!: string;
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsIn(['CASH', 'BANK', 'MOBILE_MONEY']) kind!: string;
  @IsIn(['TZS', 'KES', 'UGX', 'USD', 'EUR', 'GBP']) currency!: string;
  @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) openingDate!: string;
  @Matches(/^\d{1,16}(\.\d{1,2})?$/) openingBalance!: string;
}
export class CashMovementDto {
  @IsOptional() @Matches(/^\d{1,16}(\.\d{1,2})?$/) principal?: string;
  @IsOptional() @Matches(/^\d{1,16}(\.\d{1,2})?$/) interest?: string;
  @IsOptional() @Matches(/^\d{1,16}(\.\d{1,2})?$/) fees?: string;
  @IsOptional() @IsString() @MaxLength(128) receivableAccountId?: string;
  @IsOptional() @IsString() @MaxLength(128) payableAccountId?: string;
  @IsOptional() @IsString() @MaxLength(128) interestIncomeAccountId?: string;
  @IsOptional() @IsString() @MaxLength(128) interestExpenseAccountId?: string;
  @IsOptional() @IsString() @MaxLength(128) feeIncomeAccountId?: string;
  @IsOptional() @IsString() @MaxLength(128) feeExpenseAccountId?: string;
  @IsOptional() @IsIn(CASH_EXPENSE_CATEGORIES) expenseCategory?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(160) payee?: string;
  @IsOptional() @IsString() @MaxLength(2000) expenseNotes?: string;
  @IsUUID() requestId!: string;
  @IsIn([
    'DAILY_SALES',
    'OTHER_IN',
    'EXPENSE',
    'TRANSFER',
    'LOAN',
    'LOAN_REPAYMENT',
    'SUPPLIER_PAYMENT',
  ])
  kind!: string;
  @IsUUID() accountId!: string;
  @IsOptional() @IsUUID() targetAccountId?: string;
  @IsOptional() @IsUUID() loanId?: string;
  @IsOptional() @IsUUID() invoiceId?: string;
  @IsOptional() @IsUUID() existingInvoicePaymentId?: string;
  @IsOptional() @IsInt() @Min(1) invoiceVersion?: number;
  @Matches(/^\d{1,16}(\.\d{1,2})?$/) amount!: string;
  @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) businessDate!: string;
  @IsOptional() @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) dueDate?: string;
  @IsString() @MinLength(1) @MaxLength(500) description!: string;
  @IsString() @MaxLength(160) reference!: string;
}
export class CashExpenseQuery extends CashQuery {
  @IsOptional() @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @IsOptional() @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
  @IsOptional() @IsIn([...CASH_EXPENSE_CATEGORIES, 'UNCATEGORIZED']) expenseCategory?: string;
  @IsOptional() @IsIn(['all', 'paid', 'reversed']) status?: string;
}
export class CashReverseDto {
  @IsUUID() requestId!: string;
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
  @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) businessDate!: string;
}
