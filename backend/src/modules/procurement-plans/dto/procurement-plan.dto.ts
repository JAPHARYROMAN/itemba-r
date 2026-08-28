import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class ProcurementPlanLineDto {
  @IsOptional()
  @IsUUID('all')
  productId?: string;

  @IsString()
  description!: string;

  @IsOptional()
  @IsNumber()
  plannedQuantity?: number;

  @IsOptional()
  @IsUUID('all')
  unitId?: string;

  @IsOptional()
  @IsNumber()
  estimatedUnitCost?: number;

  @IsOptional()
  @IsNumber()
  estimatedTotalCost?: number;

  @IsOptional()
  @IsDateString()
  plannedPurchaseDate?: string;
}

export class CreateProcurementPlanDto {
  @IsString()
  planNumber!: string;

  @IsUUID('all')
  companyId!: string;

  @IsOptional()
  @IsUUID('all')
  fiscalYearId?: string;

  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  totalBudget?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProcurementPlanLineDto)
  lines?: ProcurementPlanLineDto[];
}

export class UpdateProcurementPlanDto {
  @IsOptional()
  @IsUUID('all')
  fiscalYearId?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  totalBudget?: number;

  @IsOptional()
  @IsString()
  currency?: string;
}
