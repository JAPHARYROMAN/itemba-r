import { SupplierQuotationStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class SupplierQuotationLineDto {
  @IsOptional()
  @IsUUID('all')
  productId?: string;

  @IsString()
  description!: string;

  @IsNumber()
  quantity!: number;

  @IsOptional()
  @IsUUID('all')
  unitId?: string;

  @IsNumber()
  unitPrice!: number;

  @IsOptional()
  @IsNumber()
  taxAmount?: number;

  @IsOptional()
  @IsNumber()
  discountAmount?: number;

  @IsNumber()
  lineTotal!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  deliveryDays?: number;

  @IsOptional()
  @IsString()
  warranty?: string;
}

export class CreateSupplierQuotationDto {
  @IsString()
  supplierQuotationNumber!: string;

  @IsUUID('all')
  companyId!: string;

  @IsOptional()
  @IsUUID('all')
  rfqId?: string;

  @IsUUID('all')
  supplierId!: string;

  @IsOptional()
  @IsDateString()
  quotationDate?: string;

  @IsOptional()
  @IsDateString()
  validUntil?: string;

  @IsOptional()
  @IsNumber()
  subtotal?: number;

  @IsOptional()
  @IsNumber()
  taxAmount?: number;

  @IsOptional()
  @IsNumber()
  discountAmount?: number;

  @IsOptional()
  @IsNumber()
  totalAmount?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsUUID('all')
  documentId?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SupplierQuotationLineDto)
  lines?: SupplierQuotationLineDto[];
}

export class UpdateSupplierQuotationDto {
  @IsOptional()
  @IsString()
  supplierQuotationNumber?: string;

  @IsOptional()
  @IsUUID('all')
  companyId?: string;

  @IsOptional()
  @IsUUID('all')
  rfqId?: string;

  @IsOptional()
  @IsUUID('all')
  supplierId?: string;

  @IsOptional()
  @IsDateString()
  quotationDate?: string;

  @IsOptional()
  @IsDateString()
  validUntil?: string;

  @IsOptional()
  @IsNumber()
  subtotal?: number;

  @IsOptional()
  @IsNumber()
  taxAmount?: number;

  @IsOptional()
  @IsNumber()
  discountAmount?: number;

  @IsOptional()
  @IsNumber()
  totalAmount?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsEnum(SupplierQuotationStatus)
  status?: SupplierQuotationStatus;

  @IsOptional()
  @IsUUID('all')
  documentId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
