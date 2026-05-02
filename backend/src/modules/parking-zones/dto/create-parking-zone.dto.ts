import { IsString, IsOptional, IsEnum, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';
import { ParkingZoneVehicleType, ParkingZoneStatus } from '@prisma/client';

export class CreateParkingZoneDto {
  @IsString() zoneCode!: string;
  @IsString() companyId!: string;
  @IsString() facilityId!: string;
  @IsString() zoneName!: string;
  @IsEnum(ParkingZoneVehicleType) vehicleType!: ParkingZoneVehicleType;
  @IsEnum(ParkingZoneStatus) @IsOptional() status?: ParkingZoneStatus;
  @IsNumber() @Type(() => Number) @IsOptional() capacity?: number;
  @IsString() @IsOptional() notes?: string;
}
