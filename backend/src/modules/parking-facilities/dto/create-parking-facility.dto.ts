import { IsString, IsOptional, IsEnum, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';
import { ParkingFacilityStatus } from '@prisma/client';

export class CreateParkingFacilityDto {
  @IsString() facilityCode!: string;
  @IsString() companyId!: string;
  @IsString() facilityName!: string;
  @IsString() location!: string;
  @IsEnum(ParkingFacilityStatus) @IsOptional() status?: ParkingFacilityStatus;
  @IsString() @IsOptional() divisionId?: string;
  @IsString() @IsOptional() branchId?: string;
  @IsString() @IsOptional() licensedBusinessUnitId?: string;
  @IsNumber() @Type(() => Number) @IsOptional() capacityTrucks?: number;
  @IsString() @IsOptional() managerId?: string;
  @IsString() @IsOptional() notes?: string;
}
