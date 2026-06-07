import { IsString, IsOptional, IsEnum, IsUUID, IsNumber } from 'class-validator';
import { IsNotEmpty } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StockDamageType } from '@prisma/client';

export class CreateStockDamageDto {
  @ApiProperty() @IsUUID() companyId!: string;
  @ApiProperty() @IsUUID() branchId!: string;
  @ApiProperty() @IsUUID() productId!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() batchId?: string;
  @ApiProperty() @IsNumber() quantity!: number;
  @ApiProperty() @IsString() @IsNotEmpty() unitId!: string;
  @ApiProperty({ enum: StockDamageType }) @IsEnum(StockDamageType) damageType!: StockDamageType;
  @ApiPropertyOptional() @IsOptional() @IsNumber() estimatedValue?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}
