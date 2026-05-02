import { IsString, IsOptional, IsEnum, IsNumber, IsDateString } from 'class-validator';
import { StatutoryDeductionCalcMethod, StatutoryDeductionStatus } from '@prisma/client';

export class CreateStatutoryDeductionRuleDto {
  @IsString() ruleCode!: string;
  @IsOptional() @IsString() companyId?: string;
  @IsOptional() @IsString() deductionTypeId?: string;
  @IsOptional() @IsString() taxTypeId?: string;
  @IsString() name!: string;
  @IsOptional() @IsEnum(StatutoryDeductionCalcMethod) calculationMethod?: StatutoryDeductionCalcMethod;
  @IsOptional() @IsNumber() rate?: number;
  @IsOptional() @IsNumber() amount?: number;
  @IsOptional() @IsNumber() employerContributionRate?: number;
  @IsOptional() @IsNumber() employeeContributionRate?: number;
  @IsDateString() effectiveFrom!: string;
  @IsOptional() @IsDateString() effectiveTo?: string;
  @IsOptional() @IsEnum(StatutoryDeductionStatus) status?: StatutoryDeductionStatus;
  @IsOptional() @IsString() notes?: string;
}
