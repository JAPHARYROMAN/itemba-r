import { IsString, IsOptional, IsEnum, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';
import { RentalUnitType, RentalUnitStatus, BillingFrequency } from '@prisma/client';

export class CreateRentalUnitDto {
  @IsString() unitCode!: string;
  @IsString() companyId!: string;
  @IsString() propertyId!: string;
  @IsEnum(RentalUnitType) unitType!: RentalUnitType;
  @IsString() unitNumber!: string;
  @IsNumber() @Type(() => Number) rentAmount!: number;
  @IsString() currency!: string;
  @IsEnum(BillingFrequency) billingFrequency!: BillingFrequency;
  @IsEnum(RentalUnitStatus) @IsOptional() status?: RentalUnitStatus;
  @IsString() @IsOptional() floor?: string;
  @IsString() @IsOptional() sizeDescription?: string;
  @IsNumber() @IsOptional() @Type(() => Number) securityDepositAmount?: number;
  @IsString() @IsOptional() notes?: string;
}
