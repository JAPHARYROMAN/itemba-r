import { IsOptional, IsEnum, IsUUID, IsInt, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ProductBatchStatus } from '@prisma/client';
import { Type } from 'class-transformer';

export class QueryProductBatchDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() companyId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() productId?: string;
  @ApiPropertyOptional({ enum: ProductBatchStatus }) @IsOptional() @IsEnum(ProductBatchStatus) status?: ProductBatchStatus;
  @ApiPropertyOptional() @IsOptional() @IsUUID() inventoryLocationId?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) limit?: number = 20;
}
