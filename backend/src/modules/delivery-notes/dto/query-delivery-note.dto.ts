import { IsBoolean, IsOptional, IsEnum, IsUUID, IsInt, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { DeliveryNoteStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';

export class QueryDeliveryNoteDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() companyId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional({ enum: DeliveryNoteStatus }) @IsOptional() @IsEnum(DeliveryNoteStatus) status?: DeliveryNoteStatus;
  @ApiPropertyOptional() @IsOptional() @IsUUID() customerId?: string;
  /**
   * Include the delivery notes auto-issued for POS counter sales. Default
   * false: the list is the office's dispatch worklist and a counter sale is a
   * collection, not a dispatch.
   *
   * `@Type(() => String)` is required so the global pipe's
   * enableImplicitConversion doesn't coerce the string to boolean `true` before
   * @Transform runs — without it, `?includeCounterSales=false` arrives as
   * `true`. See query-bank-account.dto.ts.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => String)
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  includeCounterSales?: boolean;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5000) limit?: number = 20;
}
