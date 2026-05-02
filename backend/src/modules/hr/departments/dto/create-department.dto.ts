import { IsString, IsOptional, IsEnum } from 'class-validator';
import { DepartmentStatus } from '@prisma/client';

export class CreateDepartmentDto {
  /**
   * Optional. When omitted/blank the service generates `{prefix}-DEPT-{NNN}`
   * using `Company.employeeCodePrefix`. Operators can supply their own
   * meaningful abbreviation (e.g., MWAN-OPS) — the override wins.
   */
  @IsOptional() @IsString() departmentCode?: string;
  @IsString() companyId!: string;
  @IsOptional() @IsString() divisionId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() licensedBusinessUnitId?: string;
  @IsString() name!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() managerId?: string;
  @IsOptional() @IsEnum(DepartmentStatus) status?: DepartmentStatus;
}
