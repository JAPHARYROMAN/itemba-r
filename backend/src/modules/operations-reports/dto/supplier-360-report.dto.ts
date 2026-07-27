import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export const SUPPLIER_360_SECTIONS = ['OVERVIEW', 'PURCHASES', 'PRODUCTS', 'PAYABLES'] as const;
export type Supplier360Section = (typeof SUPPLIER_360_SECTIONS)[number];

export class Supplier360ReportQueryDto {
  @IsString()
  @IsNotEmpty()
  companyId!: string;

  @IsString()
  @IsNotEmpty()
  supplierId!: string;

  @IsOptional()
  @IsString()
  divisionId?: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @IsString()
  purchaseStatus?: string;

  @IsOptional()
  @IsIn(['UNPAID', 'PARTIALLY_PAID', 'PAID'])
  paymentStatus?: string;

  @IsOptional()
  @IsIn(['MISSING', 'RECORDED', 'LINKED'])
  invoiceStatus?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(SUPPLIER_360_SECTIONS)
  section?: Supplier360Section = 'OVERVIEW';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number = 50;
}

export class Supplier360ExportQueryDto extends Supplier360ReportQueryDto {
  @IsIn(['pdf', 'xlsx', 'csv', 'json'])
  format!: 'pdf' | 'xlsx' | 'csv' | 'json';
}
