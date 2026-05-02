import { IsString, IsOptional, IsEnum, IsBoolean } from 'class-validator';
import { ShiftType } from '@prisma/client';

export class CreateWorkShiftDto {
  @IsString() shiftCode!: string;
  @IsString() companyId!: string;
  @IsOptional() @IsString() divisionId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsString() name!: string;
  @IsOptional() @IsEnum(ShiftType) shiftType?: ShiftType;
  @IsString() startTime!: string;
  @IsString() endTime!: string;
  @IsOptional() breakMinutes?: number;
  @IsOptional() expectedHours?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
