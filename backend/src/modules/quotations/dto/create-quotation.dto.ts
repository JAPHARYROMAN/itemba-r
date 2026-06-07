import {
  IsString,
  IsOptional,
  IsEnum,
  IsUUID,
  IsDateString,
  IsNumber,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { IsNotEmpty } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { QuotationType } from '@prisma/client';

export class CreateQuotationLineDto {
  @ApiProperty() @IsUUID() productId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiProperty() @IsNumber() quantity!: number;
  @ApiProperty() @IsString() @IsNotEmpty() unitId!: string;
  @ApiProperty() @IsNumber() unitPrice!: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() discountAmount?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() taxAmount?: number;
}

export class CreateQuotationDto {
  @ApiProperty() @IsUUID() companyId!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() divisionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() customerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() customerName?: string;
  @ApiProperty({ enum: QuotationType }) @IsEnum(QuotationType) quotationType!: QuotationType;
  @ApiProperty() @IsDateString() quotationDate!: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() validUntil?: string;
  @ApiProperty() @IsString() currency!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiProperty({ type: [CreateQuotationLineDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateQuotationLineDto)
  lines!: CreateQuotationLineDto[];
}
