import { IsOptional, IsEnum, IsUUID, IsInt, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PriceListType, PriceListStatus } from '@prisma/client';
import { Type } from 'class-transformer';

export class QueryPriceListDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() companyId?: string;
  @ApiPropertyOptional({ enum: PriceListType }) @IsOptional() @IsEnum(PriceListType) priceListType?: PriceListType;
  @ApiPropertyOptional({ enum: PriceListStatus }) @IsOptional() @IsEnum(PriceListStatus) status?: PriceListStatus;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5000) limit?: number = 20;
}
