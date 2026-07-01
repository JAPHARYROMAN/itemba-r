import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { AuditAdjustmentStatus } from '@prisma/client';
import { CompanyPagedQueryDto } from '../../../common/dto/pagination-query.dto';

export class QueryAuditAdjustmentDto extends CompanyPagedQueryDto {
  @IsOptional()
  @IsEnum(AuditAdjustmentStatus)
  status?: AuditAdjustmentStatus;
}

export class AuditAdjustmentLineDto {
  @IsString()
  accountId!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  debit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  credit?: number;
}

export class CreateAuditAdjustmentDto {
  @IsOptional()
  @IsString()
  adjustmentNumber?: string;

  @IsString()
  companyId!: string;

  @IsOptional()
  @IsString()
  fiscalYearId?: string;

  @IsOptional()
  @IsString()
  accountingPeriodId?: string;

  @IsString()
  description!: string;

  @IsString()
  reason!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AuditAdjustmentLineDto)
  lines?: AuditAdjustmentLineDto[];
}

export class ReverseAuditAdjustmentDto {
  @IsString()
  reason!: string;
}
