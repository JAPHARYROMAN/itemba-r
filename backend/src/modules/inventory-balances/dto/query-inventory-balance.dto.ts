import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class QueryInventoryBalanceDto {
  @IsOptional() @IsString() companyId?: string;
  @IsOptional() @IsString() productId?: string;
  @IsOptional() @IsString() locationId?: string;
  // `@Type(() => String)` keeps the value a string under the global pipe's
  // enableImplicitConversion (which would otherwise coerce any non-empty string
  // to boolean `true` before @Transform runs), so the parse below is correct.
  @IsOptional()
  @Type(() => String)
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  lowStock?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5000) limit?: number = 20;
}
