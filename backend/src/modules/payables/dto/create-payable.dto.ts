import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import { CurrencyCode } from '@prisma/client';

export class CreatePayableDto {
  @IsNotEmpty()
  @IsString()
  companyId!: string;

  /** Phase 1 — optional Division scope for hierarchy roll-up. */
  @IsOptional()
  @IsString()
  divisionId?: string;

  /** Phase 1 — optional Branch scope for hierarchy roll-up. */
  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsNotEmpty()
  @IsString()
  supplierName!: string;

  @IsOptional()
  @IsString()
  sourceType?: string;

  @IsOptional()
  @IsString()
  sourceId?: string;

  @IsNotEmpty()
  @IsNumber()
  amount!: number;

  @IsOptional()
  @IsEnum(CurrencyCode)
  currency?: CurrencyCode;

  @IsNotEmpty()
  @IsDateString()
  issueDate!: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
