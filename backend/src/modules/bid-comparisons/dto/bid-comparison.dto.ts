import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class CreateBidComparisonLineDto {
  @IsUUID()
  supplierQuotationId!: string;

  @IsUUID()
  supplierId!: string;

  @IsNumber()
  totalAmount!: number;

  @IsOptional()
  @IsNumber()
  deliveryScore?: number;

  @IsOptional()
  @IsNumber()
  priceScore?: number;

  @IsOptional()
  @IsNumber()
  qualityScore?: number;

  @IsOptional()
  @IsNumber()
  overallScore?: number;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class CreateBidComparisonDto {
  @IsString()
  comparisonNumber!: string;

  @IsUUID()
  companyId!: string;

  @IsUUID()
  rfqId!: string;

  @IsString()
  title!: string;

  @IsOptional()
  @IsDateString()
  comparisonDate?: string;

  @IsOptional()
  @IsUUID()
  recommendedSupplierId?: string;

  @IsOptional()
  @IsString()
  recommendationReason?: string;

  @IsOptional()
  @IsUUID()
  reviewedById?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateBidComparisonLineDto)
  lines?: CreateBidComparisonLineDto[];
}

export class UpdateBidComparisonDto extends PartialType(CreateBidComparisonDto) {}
