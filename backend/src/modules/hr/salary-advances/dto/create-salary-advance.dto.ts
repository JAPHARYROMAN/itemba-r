import { IsString, IsOptional, IsDateString, IsNumber, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { SalaryAdvanceStatus, AdvanceRepaymentMethod } from '@prisma/client';

export class CreateSalaryAdvanceDto {
  /** Server-generated when omitted (ADV-{YYYY}-#####). */
  @IsOptional() @IsString() advanceNumber?: string;
  @IsString() employeeId!: string;
  @IsString() companyId!: string;
  @IsString() createdById!: string;
  @IsNumber() @Type(() => Number) amount!: number;
  @IsOptional() @IsString() currency?: string;
  @IsDateString() requestDate!: string;
  @IsOptional() @IsEnum(AdvanceRepaymentMethod) repaymentMethod?: AdvanceRepaymentMethod;
  @IsOptional() @IsNumber() @Type(() => Number) installmentAmount?: number;
  @IsOptional() @IsEnum(SalaryAdvanceStatus) status?: SalaryAdvanceStatus;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() notes?: string;
}
