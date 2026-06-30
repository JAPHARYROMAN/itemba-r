import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ProductCategoryType } from '@prisma/client';

export class QueryProductCategoryDto {
  @IsOptional() @IsString() companyId?: string;
  @IsOptional() @IsEnum(ProductCategoryType) categoryType?: ProductCategoryType;
  @IsOptional() @IsString() parentCategoryId?: string;
  // `@Type(() => String)` keeps the value a string under the global pipe's
  // enableImplicitConversion (which would otherwise coerce any non-empty string
  // to boolean `true` before @Transform runs), so the parse below is correct.
  @IsOptional() @Type(() => String) @Transform(({ value }) => value === 'true') @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5000) limit?: number = 1000;
}
