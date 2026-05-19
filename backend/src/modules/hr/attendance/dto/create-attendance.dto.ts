import { IsString, IsOptional, IsDateString, IsNumber, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { AttendanceStatus, AttendanceSource } from '@prisma/client';

export class CreateAttendanceDto {
  @IsString() attendanceNumber!: string;
  @IsString() employeeId!: string;
  @IsString() companyId!: string;
  @IsOptional() @IsString() divisionId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() shiftScheduleId?: string;
  @IsString() createdById!: string;
  @IsDateString() attendanceDate!: string;
  @IsOptional() @IsDateString() clockInTime?: string;
  @IsOptional() @IsDateString() clockOutTime?: string;
  @IsOptional() @IsNumber() @Type(() => Number) overtimeHours?: number;
  @IsOptional() lateMinutes?: number;
  @IsOptional() earlyLeaveMinutes?: number;
  @IsOptional() @IsEnum(AttendanceStatus) attendanceStatus?: AttendanceStatus;
  @IsOptional() @IsEnum(AttendanceSource) source?: AttendanceSource;
  @IsOptional() @IsString() notes?: string;
}
