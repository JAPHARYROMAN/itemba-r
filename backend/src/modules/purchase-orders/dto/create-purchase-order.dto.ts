import {
  IsArray,
  ArrayMinSize,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CurrencyCode, PurchaseType } from '@prisma/client';

export class PurchaseOrderLineDto {
  @IsOptional()
  @IsString()
  sourceDraftLineId?: string;

  @IsNotEmpty()
  @IsString()
  productId!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNotEmpty()
  @IsNumber()
  @Min(0.0001)
  quantity!: number;

  @IsNotEmpty()
  @IsString()
  unitId!: string;

  @IsNotEmpty()
  @IsNumber()
  @Min(0.0001)
  unitCost!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  discountAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  taxAmount?: number;

  @IsOptional()
  @IsString()
  batchNumber?: string;

  @IsOptional()
  @IsDateString()
  expiryDate?: string;
}

export class CreatePurchaseOrderDto {
  @IsNotEmpty()
  @IsString()
  companyId!: string;

  @IsOptional()
  @IsString()
  divisionId?: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsOptional()
  @IsString()
  supplierName?: string;

  @IsEnum(PurchaseType)
  purchaseType!: PurchaseType;

  @IsNotEmpty()
  @IsDateString()
  orderDate!: string;

  @IsOptional()
  @IsDateString()
  expectedDate?: string;

  @IsOptional()
  @IsString()
  supplierInvoiceNumber?: string;

  @IsOptional()
  @IsDateString()
  supplierInvoiceDate?: string;

  @IsNotEmpty()
  @IsEnum(CurrencyCode)
  currency!: CurrencyCode;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderLineDto)
  lines!: PurchaseOrderLineDto[];
}
