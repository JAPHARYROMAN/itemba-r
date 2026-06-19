import { IsBoolean, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateProductFamilyDto {
  @IsString()
  companyId!: string;

  @IsOptional()
  @IsString()
  divisionId?: string | null;

  @IsString()
  categoryId!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  brand?: string | null;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  defaultPurchasePrice?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  defaultSellingPrice?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  wholesalePrice?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  retailPrice?: number | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateProductFamilyDto {
  @IsOptional()
  @IsString()
  divisionId?: string | null;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  brand?: string | null;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  defaultPurchasePrice?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  defaultSellingPrice?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  wholesalePrice?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  retailPrice?: number | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
