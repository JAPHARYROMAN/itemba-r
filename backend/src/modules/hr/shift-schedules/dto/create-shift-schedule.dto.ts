import { IsString, IsOptional, IsEnum, IsDateString } from 'class-validator';
import { ShiftScheduleStatus } from '@prisma/client';

export class CreateShiftScheduleDto {
  @IsString() scheduleNumber!: string;
  @IsString() employeeId!: string;
  @IsString() workShiftId!: string;
  @IsString() companyId!: string;
  @IsString() createdById!: string;
  @IsDateString() scheduleDate!: string;
  @IsOptional() @IsString() divisionId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsEnum(ShiftScheduleStatus) status?: ShiftScheduleStatus;
  @IsOptional() @IsString() notes?: string;
}
