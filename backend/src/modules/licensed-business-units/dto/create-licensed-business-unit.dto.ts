import { IsString, IsOptional, IsEnum, IsBoolean, IsDateString } from 'class-validator';
import { BusinessUnitType, BusinessUnitStatus } from '@prisma/client';

export class CreateLicensedBusinessUnitDto {
  @IsString() businessUnitCode!: string;
  @IsString() companyId!: string;
  @IsString() name!: string;
  @IsEnum(BusinessUnitType) businessUnitType!: BusinessUnitType;
  @IsBoolean() @IsOptional() licenseRequired?: boolean;
  @IsEnum(BusinessUnitStatus) @IsOptional() status?: BusinessUnitStatus;
  @IsString() @IsOptional() divisionId?: string;
  @IsString() @IsOptional() branchId?: string;
  @IsString() @IsOptional() tradingName?: string;
  @IsString() @IsOptional() location?: string;
  @IsString() @IsOptional() managerId?: string;
  @IsDateString() @IsOptional() startDate?: string;
  @IsDateString() @IsOptional() endDate?: string;
  @IsString() @IsOptional() notes?: string;
}
