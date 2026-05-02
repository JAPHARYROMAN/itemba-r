import { IsString, IsOptional, IsEnum, IsDateString } from 'class-validator';
import { PayrollRunStatus, PayrollType } from '@prisma/client';

export class CreatePayrollRunDto {
  @IsString() payrollRunNumber!: string;
  @IsString() payrollPeriodId!: string;
  @IsString() companyId!: string;
  @IsString() createdById!: string;
  @IsOptional() @IsDateString() runDate?: string;
  @IsOptional() @IsEnum(PayrollType) payrollType?: PayrollType;
  @IsOptional() @IsEnum(PayrollRunStatus) status?: PayrollRunStatus;
  @IsOptional() @IsString() notes?: string;
}
