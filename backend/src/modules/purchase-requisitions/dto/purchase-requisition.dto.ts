import { RequisitionPriority } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class PurchaseRequisitionLineDto {
  @IsOptional()
  @IsUUID('all')
  productId?: string;

  @IsString()
  description!: string;

  @IsNumber()
  quantity!: number;

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
  @IsUUID('all')
  preferredSupplierId?: string;
}

export class CreatePurchaseRequisitionDto {
  @IsString()
  requisitionNumber!: string;

  @IsUUID('all')
  companyId!: string;

  @IsOptional()
  @IsUUID('all')
  divisionId?: string;

  @IsOptional()
  @IsUUID('all')
  branchId?: string;

  @IsOptional()
  @IsDateString()
  requestDate?: string;

  @IsOptional()
  @IsDateString()
  neededByDate?: string;

  @IsOptional()
  @IsString()
  purpose?: string;

  @IsOptional()
  @IsEnum(RequisitionPriority)
  priority?: RequisitionPriority;

  @IsOptional()
  @IsNumber()
  totalEstimatedAmount?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PurchaseRequisitionLineDto)
  lines?: PurchaseRequisitionLineDto[];
}

export class UpdatePurchaseRequisitionDto {
  @IsOptional()
  @IsUUID('all')
  companyId?: string;

  @IsOptional()
  @IsUUID('all')
  divisionId?: string;

  @IsOptional()
  @IsUUID('all')
  branchId?: string;

  @IsOptional()
  @IsDateString()
  requestDate?: string;

  @IsOptional()
  @IsDateString()
  neededByDate?: string;

  @IsOptional()
  @IsString()
  purpose?: string;

  @IsOptional()
  @IsEnum(RequisitionPriority)
  priority?: RequisitionPriority;

  @IsOptional()
  @IsNumber()
  totalEstimatedAmount?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class RejectPurchaseRequisitionDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
