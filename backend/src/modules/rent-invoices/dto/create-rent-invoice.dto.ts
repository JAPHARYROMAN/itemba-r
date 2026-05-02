import { IsString, IsOptional, IsEnum, IsNumber, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';
import { RentInvoiceStatus } from '@prisma/client';

export class CreateRentInvoiceDto {
  @IsString() rentInvoiceNumber!: string;
  @IsString() companyId!: string;
  @IsString() propertyId!: string;
  @IsString() rentalUnitId!: string;
  @IsString() tenantId!: string;
  @IsString() leaseAgreementId!: string;
  @IsDateString() invoiceDate!: string;
  @IsDateString() billingPeriodStart!: string;
  @IsDateString() billingPeriodEnd!: string;
  @IsNumber() @Type(() => Number) rentAmount!: number;
  @IsString() currency!: string;
  @IsNumber() @Type(() => Number) totalAmount!: number;
  @IsNumber() @Type(() => Number) outstandingAmount!: number;
  @IsDateString() @IsOptional() dueDate?: string;
  @IsEnum(RentInvoiceStatus) @IsOptional() status?: RentInvoiceStatus;
  @IsNumber() @IsOptional() @Type(() => Number) penaltyAmount?: number;
  @IsNumber() @IsOptional() @Type(() => Number) discountAmount?: number;
  @IsNumber() @IsOptional() @Type(() => Number) taxAmount?: number;
  @IsNumber() @IsOptional() @Type(() => Number) paidAmount?: number;
  @IsString() @IsOptional() receivableId?: string;
  @IsString() createdById!: string;
  @IsString() @IsOptional() notes?: string;
}
