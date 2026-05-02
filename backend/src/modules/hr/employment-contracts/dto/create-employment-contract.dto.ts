import { IsString, IsOptional, IsEnum, IsDateString, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';
import { EmploymentContractType, EmploymentContractStatus, HRPaymentFrequency } from '@prisma/client';

export class CreateEmploymentContractDto {
  @IsString() contractCode!: string;
  @IsString() employeeId!: string;
  @IsString() companyId!: string;
  @IsString() createdById!: string;
  @IsOptional() @IsEnum(EmploymentContractType) contractType?: EmploymentContractType;
  @IsDateString() startDate!: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @IsDateString() probationEndDate?: string;
  @IsNumber() @Type(() => Number) salaryAmount!: number;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsEnum(HRPaymentFrequency) paymentFrequency?: HRPaymentFrequency;
  @IsOptional() @IsEnum(EmploymentContractStatus) status?: EmploymentContractStatus;
  @IsOptional() @IsString() terms?: string;
}
