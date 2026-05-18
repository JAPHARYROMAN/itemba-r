import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { SupplierInvoiceStatus } from '@prisma/client';

export class QuerySupplierInvoiceDto {
  @IsOptional()
  @IsString()
  companyId?: string;

  /** Phase 1 — filter by Division. */
  @IsOptional()
  @IsString()
  divisionId?: string;

  /** Phase 1 — filter by Branch. */
  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsOptional()
  @IsEnum(SupplierInvoiceStatus)
  status?: SupplierInvoiceStatus;

  @IsOptional()
  @IsString()
  purchaseOrderId?: string;

  @IsOptional()
  @IsString()
  goodsReceivedNoteId?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;
}
