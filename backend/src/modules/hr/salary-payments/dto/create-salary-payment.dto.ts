import { IsString, IsOptional, IsDateString, IsNumber, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { SalaryPaymentMethod, SalaryPaymentStatus } from '@prisma/client';

export class CreateSalaryPaymentDto {
  @IsString() salaryPaymentNumber!: string;
  @IsString() employeeId!: string;
  @IsString() companyId!: string;
  @IsString() payrollRunId!: string;
  @IsString() payrollEntryId!: string;
  @IsNumber() @Type(() => Number) amount!: number;
  @IsDateString() paymentDate!: string;
  @IsOptional() @IsEnum(SalaryPaymentMethod) paymentMethod?: SalaryPaymentMethod;
  @IsOptional() @IsString() cashAccountId?: string;
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @IsEnum(SalaryPaymentStatus) status?: SalaryPaymentStatus;
  @IsOptional() @IsString() paidById?: string;
  @IsOptional() @IsString() notes?: string;
}
