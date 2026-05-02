import { IsString, IsOptional, IsEnum, IsNumber, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';
import { BookingSource, BookingPaymentStatus, RoomBookingStatus } from '@prisma/client';

export class CreateRoomBookingDto {
  @IsString() bookingNumber!: string;
  @IsString() companyId!: string;
  @IsString() hospitalityFacilityId!: string;
  @IsString() roomId!: string;
  @IsString() guestId!: string;
  @IsDateString() bookingDate!: string;
  @IsDateString() expectedCheckIn!: string;
  @IsDateString() expectedCheckOut!: string;
  @IsNumber() @Type(() => Number) ratePerNight!: number;
  @IsString() currency!: string;
  @IsString() createdById!: string;
  @IsNumber() @IsOptional() @Type(() => Number) nights?: number;
  @IsNumber() @IsOptional() @Type(() => Number) subtotal?: number;
  @IsNumber() @IsOptional() @Type(() => Number) discountAmount?: number;
  @IsNumber() @IsOptional() @Type(() => Number) taxAmount?: number;
  @IsNumber() @IsOptional() @Type(() => Number) totalAmount?: number;
  @IsNumber() @IsOptional() @Type(() => Number) paidAmount?: number;
  @IsNumber() @IsOptional() @Type(() => Number) outstandingAmount?: number;
  @IsEnum(BookingSource) @IsOptional() bookingSource?: BookingSource;
  @IsEnum(BookingPaymentStatus) @IsOptional() paymentStatus?: BookingPaymentStatus;
  @IsEnum(RoomBookingStatus) @IsOptional() status?: RoomBookingStatus;
  @IsString() @IsOptional() checkedInById?: string;
  @IsString() @IsOptional() checkedOutById?: string;
  @IsString() @IsOptional() receivableId?: string;
  @IsString() @IsOptional() salesOrderId?: string;
  @IsString() @IsOptional() notes?: string;
}
