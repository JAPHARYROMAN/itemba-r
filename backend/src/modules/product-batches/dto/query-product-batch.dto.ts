import { IsOptional, IsEnum, IsUUID, IsInt, IsString, IsIn, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ProductBatchStatus } from '@prisma/client';
import { Type } from 'class-transformer';

export class QueryProductBatchDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() companyId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() productId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() divisionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() search?: string;
  @ApiPropertyOptional({ enum: ['all', 'expiring', 'expired'] })
  @IsOptional() @IsIn(['all', 'expiring', 'expired']) review?: 'all' | 'expiring' | 'expired';
  @ApiPropertyOptional({ enum: ProductBatchStatus })
  @IsOptional()
  @IsEnum(ProductBatchStatus)
  status?: ProductBatchStatus;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5000) limit?: number = 20;
}
