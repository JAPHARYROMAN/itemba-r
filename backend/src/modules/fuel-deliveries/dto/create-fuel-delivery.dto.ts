import {
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateFuelDeliveryDto {
  @IsNotEmpty()
  @IsString()
  companyId!: string;

  @IsNotEmpty()
  @IsString()
  branchId!: string;

  @IsNotEmpty()
  @IsString()
  supplierId!: string;

  @IsNotEmpty()
  @IsString()
  productId!: string;

  @IsNotEmpty()
  @IsString()
  tankId!: string;

  @IsOptional()
  @IsString()
  purchaseOrderId?: string;

  @IsNotEmpty()
  @IsDateString()
  deliveryDate!: string;

  @IsOptional()
  @IsString()
  deliveryNoteNumber?: string;

  @IsOptional()
  @IsString()
  invoiceNumber?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  orderedLitres?: number;

  @IsNotEmpty()
  @IsNumber()
  @Min(0.001)
  @Type(() => Number)
  deliveredLitres!: number;

  @IsNotEmpty()
  @IsNumber()
  @Min(0.001)
  @Type(() => Number)
  acceptedLitres!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  rejectedLitres?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  unitCost?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  totalCost?: number;

  @IsOptional()
  @IsString()
  driverName?: string;

  @IsOptional()
  @IsString()
  truckNumber?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
