import { Type } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { SupplierRating } from '@prisma/client';

export class UpsertSupplierPerformanceDto {
  @IsString()
  companyId!: string;

  @IsString()
  supplierId!: string;

  @IsOptional()
  @IsEnum(SupplierRating)
  rating?: SupplierRating;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  onTimeDeliveryRate?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  qualityScore?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  priceCompetitivenessScore?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  totalPurchases?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  totalReturns?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  disputeCount?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
