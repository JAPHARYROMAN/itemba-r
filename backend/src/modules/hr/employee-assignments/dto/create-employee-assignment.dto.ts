import { IsString, IsOptional, IsBoolean, IsDateString, IsEnum } from 'class-validator';
import { AssignmentContextType, AssignmentStatus } from '@prisma/client';

export class CreateEmployeeAssignmentDto {
  @IsString() employeeId!: string;
  @IsString() companyId!: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsString() positionId?: string;
  @IsOptional() @IsString() divisionId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsEnum(AssignmentContextType) assignmentContextType?: AssignmentContextType;
  @IsDateString() startDate!: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
  @IsOptional() @IsEnum(AssignmentStatus) status?: AssignmentStatus;
  @IsOptional() @IsString() notes?: string;
  @IsString() createdById!: string;
}
