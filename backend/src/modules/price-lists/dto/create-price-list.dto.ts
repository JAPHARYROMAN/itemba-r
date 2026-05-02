import { IsString, IsOptional, IsEnum, IsUUID, IsDateString, IsNumber, IsArray, ValidateNested, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { PriceListType } from '@prisma/client';

export class CreatePriceListItemDto {
  @ApiProperty() @IsUUID() productId!: string;
  @ApiProperty() @IsUUID() unitId!: string;
  @ApiProperty() @IsNumber() price!: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) minimumQuantity?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) maximumQuantity?: number;
}

export class CreatePriceListDto {
  @ApiProperty() @IsUUID() companyId!: string;
  @ApiProperty() @IsString() name!: string;
  @ApiProperty({ enum: PriceListType }) @IsEnum(PriceListType) priceListType!: PriceListType;
  @ApiProperty() @IsString() currency!: string;
  @ApiProperty() @IsDateString() effectiveFrom!: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() effectiveTo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiPropertyOptional({ type: [CreatePriceListItemDto] })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => CreatePriceListItemDto)
  items?: CreatePriceListItemDto[];
}
