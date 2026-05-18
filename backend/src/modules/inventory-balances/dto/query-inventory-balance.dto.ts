import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class QueryInventoryBalanceDto {
  @IsOptional() @IsString() companyId?: string;
  /** Phase 1 — filter by Division. */
  @IsOptional() @IsString() divisionId?: string;
  /** Phase 1 — explicit branch filter (alias for locationId; either works). */
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() productId?: string;
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @Transform(({ value }) => value === 'true') @IsBoolean() lowStock?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) limit?: number = 20;
}
