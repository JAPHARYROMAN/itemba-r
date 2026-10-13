import { CurrencyCode } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const PERFORMANCE_CATEGORIES = [
  'best',
  'good',
  'needs-attention',
  'insufficient-history',
  'inactive',
] as const;
export type PerformanceCategory = (typeof PERFORMANCE_CATEGORIES)[number];

export class CustomerPerformanceQueryDto {
  @IsOptional() @IsString() companyId?: string;
  @IsOptional() @IsString() divisionId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsEnum(CurrencyCode) currency?: CurrencyCode;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsDateString({ strict: true }) dateFrom?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsDateString({ strict: true }) dateTo?: string;
  @IsOptional() @IsString() @MaxLength(160) search?: string;
  @IsOptional() @IsIn(PERFORMANCE_CATEGORIES) category?: PerformanceCategory;
  @IsOptional() @IsIn(['net-sales', 'collected', 'overdue', 'name']) sort?:
    | 'net-sales'
    | 'collected'
    | 'overdue'
    | 'name';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit: number = 25;
}
