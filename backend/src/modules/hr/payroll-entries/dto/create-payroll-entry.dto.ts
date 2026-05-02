import { IsOptional, IsNumber, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePayrollEntryDto {
  @IsOptional() @IsNumber() @Type(() => Number) basePay?: number;
  @IsOptional() @IsNumber() @Type(() => Number) overtimePay?: number;
  @IsOptional() @IsNumber() @Type(() => Number) attendancePay?: number;
  @IsOptional() @IsNumber() @Type(() => Number) totalAllowances?: number;
  @IsOptional() @IsNumber() @Type(() => Number) totalDeductions?: number;
  @IsOptional() @IsNumber() @Type(() => Number) grossPay?: number;
  @IsOptional() @IsNumber() @Type(() => Number) netPay?: number;
  @IsOptional() @IsNumber() @Type(() => Number) daysWorked?: number;
  @IsOptional() @IsNumber() @Type(() => Number) hoursWorked?: number;
  @IsOptional() @IsNumber() @Type(() => Number) overtimeHours?: number;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() notes?: string;
}
