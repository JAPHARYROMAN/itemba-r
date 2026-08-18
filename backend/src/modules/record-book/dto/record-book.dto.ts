import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  CurrencyCode,
  RecordBookPaymentMethod,
  RecordBookReceiptType,
  RecordBookStatus,
} from '@prisma/client';

export class QueryRecordBookDto {
  @IsOptional() @IsString() companyId?: string;
  @IsOptional() @IsString() divisionId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() expenseCategoryId?: string;
  @IsOptional() @IsEnum(RecordBookStatus) status?: RecordBookStatus;
  @IsOptional() @IsEnum(CurrencyCode) currency?: CurrencyCode;
  @IsOptional() @IsString() @MaxLength(200) search?: string;
  @IsOptional() @IsString() dateFrom?: string;
  @IsOptional() @IsString() dateTo?: string;
  @IsOptional() @IsIn(['ACTIVE', 'DELETED']) recordState?: 'ACTIVE' | 'DELETED';
  @IsOptional() @IsEnum(RecordBookReceiptType) receiptType?: RecordBookReceiptType;
  @IsOptional() @IsEnum(RecordBookPaymentMethod) paymentMethod?: RecordBookPaymentMethod;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5000) limit?: number = 20;
}

export const RECORD_BOOK_REPORT_KEYS = [
  'daily-sales',
  'receipt-methods',
  'expenses-by-category',
  'expenses-by-payee',
  'net-movement',
  'branch-comparison',
  'monthly-trend',
] as const;

export type RecordBookReportKey = (typeof RECORD_BOOK_REPORT_KEYS)[number];

export class QueryRecordBookReportDto extends QueryRecordBookDto {
  @IsOptional()
  @IsIn(['FINALIZED', 'DRAFT', 'VOIDED', 'ACTIVE', 'ALL'])
  reportStatus?: 'FINALIZED' | 'DRAFT' | 'VOIDED' | 'ACTIVE' | 'ALL';
}

export class ExportRecordBookReportDto extends QueryRecordBookReportDto {
  @IsOptional()
  @IsIn(['pdf', 'json', 'csv', 'xlsx'])
  format?: 'pdf' | 'json' | 'csv' | 'xlsx';
}

export class RecordBookExportAuditDto {
  @IsIn(['raw', 'report'])
  scope!: 'raw' | 'report';

  @IsOptional()
  @IsIn(RECORD_BOOK_REPORT_KEYS)
  reportKey?: RecordBookReportKey;

  @IsIn(['pdf', 'print', 'json', 'csv', 'xlsx'])
  format!: 'pdf' | 'print' | 'json' | 'csv' | 'xlsx';

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(50_000)
  rowCount!: number;

  @IsOptional() @IsString() companyId?: string;
  @IsOptional() @IsString() divisionId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() dateFrom?: string;
  @IsOptional() @IsString() dateTo?: string;
}

export class RecordBookReceiptDto {
  @IsEnum(RecordBookReceiptType)
  receiptType!: RecordBookReceiptType;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;

  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class CreateDailySaleDto {
  @IsNotEmpty() @IsString() companyId!: string;
  @IsOptional() @IsString() divisionId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsDateString() recordDate!: string;
  @IsOptional() @IsEnum(CurrencyCode) currency?: CurrencyCode;
  @IsNumber() @Min(0.01) totalSalesAmount!: number;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RecordBookReceiptDto)
  receipts!: RecordBookReceiptDto[];
}

export class UpdateDailySaleDto {
  @IsOptional() @IsString() divisionId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsDateString() recordDate?: string;
  @IsOptional() @IsEnum(CurrencyCode) currency?: CurrencyCode;
  @IsOptional() @IsNumber() @Min(0.01) totalSalesAmount?: number;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RecordBookReceiptDto)
  receipts?: RecordBookReceiptDto[];
}

export class CreateRecordBookExpenseDto {
  @IsNotEmpty() @IsString() companyId!: string;
  @IsOptional() @IsString() divisionId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsNotEmpty() @IsString() expenseCategoryId!: string;
  @IsDateString() recordDate!: string;
  @IsOptional() @IsEnum(CurrencyCode) currency?: CurrencyCode;
  @IsNumber() @Min(0.01) amount!: number;
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsNotEmpty()
  @IsString()
  @MaxLength(500)
  description!: string;
  @IsOptional() @IsString() @MaxLength(200) paidTo?: string;
  @IsOptional() @IsEnum(RecordBookPaymentMethod) paymentMethod?: RecordBookPaymentMethod;
  @IsOptional() @IsString() @MaxLength(120) paymentLabel?: string;
  @IsOptional() @IsString() @MaxLength(200) reference?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class UpdateRecordBookExpenseDto {
  @IsOptional() @IsString() divisionId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() expenseCategoryId?: string;
  @IsOptional() @IsDateString() recordDate?: string;
  @IsOptional() @IsEnum(CurrencyCode) currency?: CurrencyCode;
  @IsOptional() @IsNumber() @Min(0.01) amount?: number;
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsNotEmpty()
  @IsString()
  @MaxLength(500)
  description?: string;
  @IsOptional() @IsString() @MaxLength(200) paidTo?: string;
  @IsOptional() @IsEnum(RecordBookPaymentMethod) paymentMethod?: RecordBookPaymentMethod;
  @IsOptional() @IsString() @MaxLength(120) paymentLabel?: string;
  @IsOptional() @IsString() @MaxLength(200) reference?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class CreateRecordBookCategoryDto {
  @IsNotEmpty() @IsString() companyId!: string;
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsNotEmpty()
  @IsString()
  @MaxLength(120)
  name!: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateRecordBookCategoryDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsNotEmpty()
  @IsString()
  @MaxLength(120)
  name?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class VoidRecordBookDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsNotEmpty()
  @IsString()
  @MaxLength(500)
  reason!: string;
}

export class ReopenRecordBookDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsNotEmpty()
  @IsString()
  @MaxLength(500)
  reason!: string;
}

export class ExportRecordBookDto extends QueryRecordBookDto {
  @IsOptional()
  @IsIn(['sales', 'expenses', 'combined'])
  type?: 'sales' | 'expenses' | 'combined';

  @IsOptional()
  @IsIn(['json', 'csv', 'xlsx', 'pdf'])
  format?: 'json' | 'csv' | 'xlsx' | 'pdf';
}
