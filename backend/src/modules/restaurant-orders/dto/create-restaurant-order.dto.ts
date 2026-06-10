import {
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  IsDateString,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { RestaurantOrderType } from '@prisma/client';

export class CreateRestaurantOrderLineDto {
  @IsString() menuItemId!: string;
  @IsNumber() @Type(() => Number) quantity!: number;
  @IsNumber() @Type(() => Number) unitPrice!: number;
  @IsNumber() @IsOptional() @Type(() => Number) discountAmount?: number;
  @IsNumber() @IsOptional() @Type(() => Number) taxAmount?: number;
  @IsString() @IsOptional() productId?: string;
  @IsString() @IsOptional() notes?: string;
}

export class CreateRestaurantOrderDto {
  @IsString() orderNumber!: string;
  @IsString() companyId!: string;
  @IsString() hospitalityFacilityId!: string;
  @IsEnum(RestaurantOrderType) orderType!: RestaurantOrderType;
  @IsDateString() orderDate!: string;
  @IsString() currency!: string;
  @IsString() @IsOptional() tableId?: string;
  @IsString() @IsOptional() guestId?: string;
  @IsString() @IsOptional() customerId?: string;
  // Monetary totals (subtotal/taxAmount/totalAmount/paidAmount/outstandingAmount)
  // and paymentStatus are NOT accepted from the client; they are computed
  // server-side from the validated lines. See ITMB-002 / ITMB-038.
  @IsString() @IsOptional() waiterId?: string;
  @IsString() @IsOptional() cashierId?: string;
  @IsString() @IsOptional() notes?: string;
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CreateRestaurantOrderLineDto)
  lines?: CreateRestaurantOrderLineDto[];
}
