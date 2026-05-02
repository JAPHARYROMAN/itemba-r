import { IsString, IsOptional, IsEnum, IsNumber, IsDateString } from 'class-validator';
import { FarmInputApplicationType } from '@prisma/client';

export class CreateFarmInputApplicationDto {
  @IsString() companyId!: string;
  @IsString() divisionId!: string;
  @IsString() farmId!: string;
  @IsString() @IsOptional() fieldId?: string;
  @IsString() cropSeasonId!: string;
  @IsString() productId!: string;
  @IsString() @IsOptional() inventoryLocationId?: string;
  @IsDateString() applicationDate!: string;
  @IsNumber() quantity!: number;
  @IsString() unitId!: string;
  @IsNumber() @IsOptional() unitCost?: number;
  @IsNumber() @IsOptional() totalCost?: number;
  @IsEnum(FarmInputApplicationType) applicationType!: FarmInputApplicationType;
  @IsString() @IsOptional() appliedById?: string;
  @IsString() @IsOptional() notes?: string;
}
