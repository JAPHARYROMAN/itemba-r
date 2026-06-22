import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { SupplierRating } from '@prisma/client';

export class QuerySupplierPerformanceDto {
  @IsOptional() @IsString() companyId?: string;
  @IsOptional() @IsString() supplierId?: string;
  @IsOptional() @IsEnum(SupplierRating) rating?: SupplierRating;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number = 20;
}
