import { IsString, IsOptional, IsDateString, IsNumber, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { AllowanceDeductionStatus } from '@prisma/client';

export class CreateEmployeeAllowanceDto {
  @IsString() employeeId!: string;
  @IsString() allowanceTypeId!: string;
  @IsString() companyId!: string;
  @IsNumber() @Type(() => Number) amount!: number;
  @IsDateString() effectiveFrom!: string;
  @IsOptional() @IsDateString() effectiveTo?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsEnum(AllowanceDeductionStatus) status?: AllowanceDeductionStatus;
}
