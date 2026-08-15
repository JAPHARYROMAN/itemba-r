import {
  IsString,
  IsOptional,
  IsUUID,
  IsDateString,
  IsNumber,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { IsNotEmpty } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateDeliveryNoteLineDto {
  @ApiProperty() @IsUUID() productId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiProperty() @IsNumber() quantity!: number;
  @ApiProperty() @IsString() @IsNotEmpty() unitId!: string;
  /**
   * ACCEPTED AND IGNORED. There is no `salesOrderLineId` column on
   * `delivery_note_lines` — not in schema.prisma, not in any migration, not in
   * the generated client — so nothing is stored and nothing reads it back.
   *
   * It stays on the DTO only because the global pipe runs
   * `forbidNonWhitelisted`: the desktop delivery-note modal already sends this
   * key on every line, and deleting the property here would turn those requests
   * into a 400 instead of fixing them. Removing it for good is a coordinated
   * frontend change, not a backend one.
   *
   * If a delivery line ever genuinely needs to point at the order line it
   * fulfils, that wants a column, a migration and an actual reader — not a
   * silent write. Until then this must never reach Prisma.
   */
  @ApiPropertyOptional({
    deprecated: true,
    description: 'Ignored. No such column exists on delivery_note_lines; nothing is stored.',
  })
  @IsOptional()
  @IsUUID()
  salesOrderLineId?: string;
}

export class CreateDeliveryNoteDto {
  @ApiProperty() @IsUUID() companyId!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiProperty() @IsUUID() salesOrderId!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() customerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() customerName?: string;
  @ApiProperty() @IsDateString() deliveryDate!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() deliveryAddress?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() deliveredById?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() vehicleNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() driverName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiProperty({ type: [CreateDeliveryNoteLineDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateDeliveryNoteLineDto)
  lines!: CreateDeliveryNoteLineDto[];
}
