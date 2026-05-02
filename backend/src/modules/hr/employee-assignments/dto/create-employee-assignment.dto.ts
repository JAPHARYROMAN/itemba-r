import { IsString, IsOptional, IsBoolean, IsDateString } from 'class-validator';

export class CreateEmployeeAssignmentDto {
  @IsString() employeeId!: string;
  @IsString() companyId!: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsString() positionId?: string;
  @IsOptional() @IsString() divisionId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsDateString() startDate!: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
  @IsOptional() @IsString() notes?: string;
  @IsString() createdById!: string;
}
