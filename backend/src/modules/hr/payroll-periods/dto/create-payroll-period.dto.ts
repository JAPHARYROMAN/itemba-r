import { IsString, IsOptional, IsEnum, IsDateString } from 'class-validator';
import { PayrollPeriodStatus } from '@prisma/client';

export class CreatePayrollPeriodDto {
  /** Server-generated when omitted (PP-{YYYY}-####). */
  @IsOptional() @IsString() payrollPeriodCode?: string;
  @IsString() name!: string;
  @IsString() companyId!: string;
  @IsString() createdById!: string;
  @IsDateString() startDate!: string;
  @IsDateString() endDate!: string;
  @IsOptional() @IsDateString() paymentDate?: string;
  @IsOptional() @IsEnum(PayrollPeriodStatus) status?: PayrollPeriodStatus;
}
