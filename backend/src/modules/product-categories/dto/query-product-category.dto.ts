import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ProductCategoryType } from '@prisma/client';

export class QueryProductCategoryDto {
  @IsOptional() @IsString() companyId?: string;
  @IsOptional() @IsEnum(ProductCategoryType) categoryType?: ProductCategoryType;
  @IsOptional() @IsString() parentCategoryId?: string;
  @IsOptional() @Type(() => Boolean) @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5000) limit?: number = 1000;
}
