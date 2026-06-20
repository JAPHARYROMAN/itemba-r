import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ProductType, ProductStatus } from '@prisma/client';

export class QueryProductDto {
  @IsOptional() @IsString() companyId?: string;
  @IsOptional() @IsString() divisionId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() productFamilyId?: string;
  @IsOptional() @IsString() supplierId?: string;
  @IsOptional() @IsEnum(ProductType) productType?: ProductType;
  @IsOptional() @IsEnum(ProductStatus) status?: ProductStatus;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) limit?: number = 20;
}
