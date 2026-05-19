import { IsString, IsOptional, IsDateString, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateLeaveRequestDto {
  @IsString() leaveRequestNumber!: string;
  @IsString() employeeId!: string;
  @IsString() leaveTypeId!: string;
  @IsString() companyId!: string;
  @IsOptional() @IsString() divisionId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsString() createdById!: string;
  @IsDateString() startDate!: string;
  @IsDateString() endDate!: string;
  @IsNumber() @Type(() => Number) totalDays!: number;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() status?: string;
}
