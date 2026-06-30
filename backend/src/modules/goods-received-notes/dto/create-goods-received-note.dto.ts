import {
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateGoodsReceivedNoteLineDto {
  @IsString()
  @IsNotEmpty()
  productId!: string;

  @IsString()
  @IsNotEmpty()
  unitId!: string;

  // All quantities are non-negative. A crafted negative acceptedQuantity would
  // be skipped by the posting loop (acceptedQuantity <= 0) while still reducing
  // the PO received-to-date accumulation, desyncing inventory from the PO. The
  // @Min(0) guards close that hole at the boundary; post() additionally clamps
  // negatives defensively.
  @IsOptional()
  @IsNumber()
  @Min(0)
  orderedQuantity?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  receivedQuantity?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  acceptedQuantity?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  rejectedQuantity?: number;

  // Optional per-line captured landed/unit cost. When set, post() treats this as
  // the authoritative cost for the receipt (priority over the PO line cost and the
  // product default purchase price) and values the inventory movement at it.
  @IsOptional()
  @IsNumber()
  @Min(0)
  unitCost?: number;

  @IsOptional()
  @IsString()
  condition?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateGoodsReceivedNoteDto {
  @IsOptional()
  @IsString()
  companyId?: string;

  @IsOptional()
  @IsString()
  divisionId?: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsString()
  purchaseOrderId?: string;

  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsOptional()
  @IsString()
  grnNumber?: string;

  @IsOptional()
  @IsDateString()
  receivedDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateGoodsReceivedNoteLineDto)
  lines?: CreateGoodsReceivedNoteLineDto[];
}
