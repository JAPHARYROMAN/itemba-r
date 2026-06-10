import { IsString, IsOptional, IsEnum, IsNumber, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';
import { LeaseStatus, BillingFrequency } from '@prisma/client';

export class CreateLeaseAgreementDto {
  @IsString() leaseCode!: string;
  @IsString() companyId!: string;
  @IsString() propertyId!: string;
  @IsString() rentalUnitId!: string;
  @IsString() tenantId!: string;
  @IsDateString() startDate!: string;
  @IsNumber() @Type(() => Number) rentAmount!: number;
  @IsString() currency!: string;
  @IsEnum(BillingFrequency) billingFrequency!: BillingFrequency;
  @IsEnum(LeaseStatus) @IsOptional() status?: LeaseStatus;
  @IsString() @IsOptional() contractId?: string;
  @IsDateString() @IsOptional() endDate?: string;
  @IsNumber() @IsOptional() @Type(() => Number) securityDepositAmount?: number;
  @IsNumber() @IsOptional() @Type(() => Number) securityDepositPaid?: number;
  @IsString() @IsOptional() paymentTerms?: string;
  @IsString() @IsOptional() notes?: string;
}
