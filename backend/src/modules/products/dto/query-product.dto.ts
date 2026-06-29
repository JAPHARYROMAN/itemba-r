import { IsEnum, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ProductType, ProductStatus } from '@prisma/client';
import { PRICE_SOURCES, PriceSource } from '../price-source-where';

export class QueryProductDto {
  @IsOptional() @IsString() companyId?: string;
  @IsOptional() @IsString() divisionId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() productFamilyId?: string;
  @IsOptional() @IsString() supplierId?: string;
  @IsOptional() @IsEnum(ProductType) productType?: ProductType;
  @IsOptional() @IsEnum(ProductStatus) status?: ProductStatus;
  // Pricing-hygiene worklist filter; mirrors the computed priceSource.
  @IsOptional() @IsIn(PRICE_SOURCES) priceSource?: PriceSource;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5000) limit?: number = 20;
}
