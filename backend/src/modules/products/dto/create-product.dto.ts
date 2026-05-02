import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ProductType, ProductStatus } from '@prisma/client';

export class CreateProductDto {
  @IsNotEmpty()
  @IsString()
  companyId!: string;

  /**
   * Optional FK to Division — scopes the SKU to a specific division. When
   * set, sales pickers (Quick Sale, Sales Orders) filter to this division.
   * Null = company-wide.
   */
  @IsOptional()
  @IsString()
  divisionId?: string;

  @IsNotEmpty()
  @IsString()
  categoryId!: string;

  @IsNotEmpty()
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNotEmpty()
  @IsEnum(ProductType)
  productType!: ProductType;

  @IsNotEmpty()
  @IsString()
  baseUnitId!: string;

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
