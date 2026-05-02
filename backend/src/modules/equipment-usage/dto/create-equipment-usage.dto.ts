import { IsString, IsOptional, IsEnum, IsDateString, IsNumber } from 'class-validator';
import { EquipmentUsageContextType } from '@prisma/client';

export class CreateEquipmentUsageDto {
  @IsString() companyId!: string;
  @IsString() divisionId!: string;
  @IsString() @IsOptional() branchId?: string;
  @IsString() @IsOptional() fixedAssetId?: string;
  @IsString() @IsOptional() equipmentName?: string;
  @IsEnum(EquipmentUsageContextType) @IsOptional() usageContextType?: EquipmentUsageContextType;
  @IsString() @IsOptional() usageContextId?: string;
  @IsDateString() usageDate!: string;
  @IsNumber() @IsOptional() startMeterReading?: number;
  @IsNumber() @IsOptional() endMeterReading?: number;
  @IsNumber() @IsOptional() hoursUsed?: number;
  @IsNumber() @IsOptional() fuelUsedLitres?: number;
  @IsString() @IsOptional() operatorId?: string;
  @IsNumber() @IsOptional() costAmount?: number;
  @IsString() @IsOptional() currency?: string;
  @IsString() @IsOptional() notes?: string;
}
