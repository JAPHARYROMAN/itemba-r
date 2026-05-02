import { IsString, IsOptional, IsEnum, IsNumber, IsDateString } from 'class-validator';
import { CropSeasonStatus } from '@prisma/client';

export class CreateCropSeasonDto {
  @IsString() seasonCode!: string;
  @IsString() companyId!: string;
  @IsString() divisionId!: string;
  @IsString() farmId!: string;
  @IsString() @IsOptional() fieldId?: string;
  @IsString() cropId!: string;
  @IsString() seasonName!: string;
  @IsDateString() @IsOptional() plantingDate?: string;
  @IsDateString() @IsOptional() expectedHarvestDate?: string;
  @IsNumber() @IsOptional() expectedYield?: number;
  @IsString() @IsOptional() yieldUnitId?: string;
  @IsEnum(CropSeasonStatus) @IsOptional() status?: CropSeasonStatus;
  @IsNumber() @IsOptional() budgetAmount?: number;
  @IsString() @IsOptional() currency?: string;
  @IsString() @IsOptional() notes?: string;
}
