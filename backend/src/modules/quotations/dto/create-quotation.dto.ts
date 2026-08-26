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
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { QuotationType } from '@prisma/client';

/**
 * A line is EITHER a catalogue line (productId + unitId) OR an ad-hoc one
 * (itemName, optionally unitLabel). Both halves are optional here on purpose:
 * the either/or is enforced in QuotationsService, which can say "Line 3 needs a
 * product or an item name" instead of the pipe's "lines.2.productId must be a
 * UUID". A salesperson can act on the first message and not the second.
 */
export class CreateQuotationLineDto {
  @ApiPropertyOptional({ description: 'Catalogue product. Omit for an ad-hoc item and send itemName.' })
  @IsOptional() @IsUUID() productId?: string;
  @ApiPropertyOptional({ description: 'Free-text item name. Required when productId is omitted.' })
  @IsOptional() @IsString() itemName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiProperty() @IsNumber() quantity!: number;
  @ApiPropertyOptional({ description: 'Catalogue unit. Omit for an ad-hoc item and send unitLabel.' })
  @IsOptional() @IsString() unitId?: string;
  @ApiPropertyOptional({ description: 'Free-text unit such as "bag" or "trip". Used when unitId is omitted.' })
  @IsOptional() @IsString() unitLabel?: string;
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
