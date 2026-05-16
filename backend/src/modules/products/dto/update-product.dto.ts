import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ProductType, ProductStatus } from '@prisma/client';

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  productCode?: string;

  @IsOptional()
  @IsString()
  divisionId?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  productFamilyId?: string | null;

  @IsOptional()
  @IsString()
  productFamilyName?: string;

  @IsOptional()
  @IsString()
  productFamilyBrand?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  variantName?: string | null;

  @IsOptional()
  @IsString()
  variantColor?: string | null;

  @IsOptional()
  @IsString()
  variantSize?: string | null;

  @IsOptional()
  @IsString()
  variantFinish?: string | null;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(ProductType)
  productType?: ProductType;

  @IsOptional()
  @IsString()
  baseUnitId?: string;

  @IsOptional()
  @IsString()
  purchaseUnitId?: string;

  @IsOptional()
  @IsString()
  salesUnitId?: string;

  @IsOptional()
  @IsString()
  barcode?: string;

  @IsOptional()
  @IsString()
  sku?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  defaultPurchasePrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  defaultSellingPrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  wholesalePrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  retailPrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minimumStockLevel?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maximumStockLevel?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  reorderLevel?: number;

  @IsOptional()
  @IsBoolean()
  trackInventory?: boolean;

  @IsOptional()
  @IsBoolean()
  trackBatch?: boolean;

  @IsOptional()
  @IsBoolean()
  trackExpiry?: boolean;

  @IsOptional()
  @IsBoolean()
  isTaxable?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  taxRate?: number;

  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;
}
