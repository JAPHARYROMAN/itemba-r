import { Type } from 'class-transformer';
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
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsString() dateFrom?: string;
  @IsOptional() @IsString() dateTo?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5000) limit?: number = 20;
}

export class RecordBookReceiptDto {
  @IsEnum(RecordBookReceiptType)
  receiptType!: RecordBookReceiptType;

  @IsOptional()
  @IsString()
  label?: string;

  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateDailySaleDto {
  @IsNotEmpty() @IsString() companyId!: string;
  @IsOptional() @IsString() divisionId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsDateString() recordDate!: string;
  @IsOptional() @IsEnum(CurrencyCode) currency?: CurrencyCode;
  @IsNumber() @Min(0.01) totalSalesAmount!: number;
  @IsOptional() @IsString() notes?: string;

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
  @IsOptional() @IsString() notes?: string;

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
  @IsNotEmpty() @IsString() description!: string;
  @IsOptional() @IsString() paidTo?: string;
  @IsOptional() @IsEnum(RecordBookPaymentMethod) paymentMethod?: RecordBookPaymentMethod;
  @IsOptional() @IsString() paymentLabel?: string;
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @IsString() notes?: string;
}

export class UpdateRecordBookExpenseDto {
  @IsOptional() @IsString() divisionId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() expenseCategoryId?: string;
  @IsOptional() @IsDateString() recordDate?: string;
  @IsOptional() @IsEnum(CurrencyCode) currency?: CurrencyCode;
  @IsOptional() @IsNumber() @Min(0.01) amount?: number;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() paidTo?: string;
  @IsOptional() @IsEnum(RecordBookPaymentMethod) paymentMethod?: RecordBookPaymentMethod;
  @IsOptional() @IsString() paymentLabel?: string;
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @IsString() notes?: string;
}

export class CreateRecordBookCategoryDto {
  @IsNotEmpty() @IsString() companyId!: string;
  @IsNotEmpty() @IsString() name!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateRecordBookCategoryDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class VoidRecordBookDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

export class ExportRecordBookDto extends QueryRecordBookDto {
  @IsOptional()
  @IsIn(['sales', 'expenses', 'combined'])
  type?: 'sales' | 'expenses' | 'combined';

  @IsOptional()
  @IsIn(['json', 'csv', 'xlsx'])
  format?: 'json' | 'csv' | 'xlsx';
}
