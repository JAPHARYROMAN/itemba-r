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
import {
  RestaurantOrderType,
  RestaurantOrderStatus,
  RestaurantOrderPaymentStatus,
} from '@prisma/client';

export class CreateRestaurantOrderLineDto {
  @IsString() menuItemId!: string;
  @IsNumber() @Type(() => Number) quantity!: number;
  @IsNumber() @Type(() => Number) unitPrice!: number;
  @IsNumber() @Type(() => Number) lineTotal!: number;
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
  @IsNumber() @IsOptional() @Type(() => Number) subtotal?: number;
  @IsNumber() @IsOptional() @Type(() => Number) discountAmount?: number;
  @IsNumber() @IsOptional() @Type(() => Number) taxAmount?: number;
  @IsNumber() @IsOptional() @Type(() => Number) totalAmount?: number;
  @IsNumber() @IsOptional() @Type(() => Number) paidAmount?: number;
  @IsNumber() @IsOptional() @Type(() => Number) outstandingAmount?: number;
  @IsEnum(RestaurantOrderPaymentStatus) @IsOptional() paymentStatus?: RestaurantOrderPaymentStatus;
  @IsEnum(RestaurantOrderStatus) @IsOptional() status?: RestaurantOrderStatus;
  @IsString() @IsOptional() waiterId?: string;
  @IsString() @IsOptional() cashierId?: string;
  @IsString() @IsOptional() notes?: string;
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CreateRestaurantOrderLineDto)
  lines?: CreateRestaurantOrderLineDto[];
}
