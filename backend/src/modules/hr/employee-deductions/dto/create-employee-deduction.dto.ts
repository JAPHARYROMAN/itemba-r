import { IsString, IsOptional, IsDateString, IsNumber, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { AllowanceDeductionStatus } from '@prisma/client';

export class CreateEmployeeDeductionDto {
  @IsString() employeeId!: string;
  @IsString() deductionTypeId!: string;
  @IsString() companyId!: string;
  @IsOptional() @IsNumber() @Type(() => Number) amount?: number;
  @IsOptional() @IsNumber() @Type(() => Number) percentage?: number;
  @IsDateString() effectiveFrom!: string;
  @IsOptional() @IsDateString() effectiveTo?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsEnum(AllowanceDeductionStatus) status?: AllowanceDeductionStatus;
}
