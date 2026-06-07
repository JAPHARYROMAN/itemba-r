import { IsOptional, IsNumber, IsUUID, Min } from 'class-validator';
import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePriceListItemStandaloneDto {
  @ApiProperty() @IsUUID() productId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() unitId!: string;
  @ApiProperty() @IsNumber() price!: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) minimumQuantity?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) maximumQuantity?: number;
}

export class UpdatePriceListItemDto {
  @ApiPropertyOptional() @IsOptional() @IsNumber() price?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) minimumQuantity?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) maximumQuantity?: number;
}
