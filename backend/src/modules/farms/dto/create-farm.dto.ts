import { IsString, IsOptional, IsEnum, IsNumber } from 'class-validator';
import { FarmOwnershipType, FarmStatus } from '@prisma/client';

export class CreateFarmDto {
  @IsString() farmCode!: string;
  @IsString() companyId!: string;
  @IsString() divisionId!: string;
  @IsString() @IsOptional() fixedAssetId?: string;
  @IsString() name!: string;
  @IsString() location!: string;
  @IsNumber() @IsOptional() sizeValue?: number;
  @IsString() @IsOptional() sizeUnitId?: string;
  @IsEnum(FarmOwnershipType) @IsOptional() ownershipType?: FarmOwnershipType;
  @IsEnum(FarmStatus) @IsOptional() status?: FarmStatus;
  @IsString() @IsOptional() managerId?: string;
  @IsString() @IsOptional() notes?: string;
}
