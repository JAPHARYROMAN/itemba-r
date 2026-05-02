import { IsString, IsOptional, IsEnum } from 'class-validator';
import { HospitalityFacilityType, HospitalityFacilityStatus } from '@prisma/client';

export class CreateHospitalityFacilityDto {
  @IsString() facilityCode!: string;
  @IsString() companyId!: string;
  @IsString() facilityName!: string;
  @IsEnum(HospitalityFacilityType) facilityType!: HospitalityFacilityType;
  @IsString() location!: string;
  @IsEnum(HospitalityFacilityStatus) @IsOptional() status?: HospitalityFacilityStatus;
  @IsString() @IsOptional() divisionId?: string;
  @IsString() @IsOptional() branchId?: string;
  @IsString() @IsOptional() licensedBusinessUnitId?: string;
  @IsString() @IsOptional() managerId?: string;
  @IsString() @IsOptional() notes?: string;
}
