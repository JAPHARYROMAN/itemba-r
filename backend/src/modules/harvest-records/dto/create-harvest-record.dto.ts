import { IsString, IsOptional, IsNumber, IsDateString } from 'class-validator';

export class CreateHarvestRecordDto {
  @IsString() companyId!: string;
  @IsString() divisionId!: string;
  @IsString() farmId!: string;
  @IsString() @IsOptional() fieldId?: string;
  @IsString() @IsOptional() branchId?: string;
  @IsString() cropSeasonId!: string;
  @IsString() @IsOptional() productId?: string;
  @IsDateString() harvestDate!: string;
  @IsNumber() quantity!: number;
  @IsString() unitId!: string;
  @IsString() @IsOptional() qualityGrade?: string;
  @IsNumber() @IsOptional() estimatedUnitValue?: number;
  @IsNumber() @IsOptional() estimatedTotalValue?: number;
  @IsString() @IsOptional() harvestedById?: string;
  @IsString() @IsOptional() notes?: string;
}
