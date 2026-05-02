import { IsString, IsOptional, IsEnum, IsNumber, IsDateString } from 'class-validator';
import { ConstructionProjectType, ConstructionProjectStatus } from '@prisma/client';

export class CreateConstructionProjectDto {
  @IsString() projectCode!: string;
  @IsString() companyId!: string;
  @IsString() divisionId!: string;
  @IsString() @IsOptional() branchId?: string;
  @IsString() @IsOptional() customerId?: string;
  @IsString() @IsOptional() clientName?: string;
  @IsString() projectName!: string;
  @IsEnum(ConstructionProjectType) projectType!: ConstructionProjectType;
  @IsString() @IsOptional() location?: string;
  @IsString() @IsOptional() contractId?: string;
  @IsDateString() @IsOptional() startDate?: string;
  @IsDateString() @IsOptional() expectedEndDate?: string;
  @IsNumber() @IsOptional() contractValue?: number;
  @IsNumber() @IsOptional() budgetAmount?: number;
  @IsString() currency!: string;
  @IsEnum(ConstructionProjectStatus) @IsOptional() status?: ConstructionProjectStatus;
  @IsString() @IsOptional() projectManagerId?: string;
  @IsString() @IsOptional() notes?: string;
}
