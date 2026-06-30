import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';
import { ThreeWayMatchStatus } from '@prisma/client';
import { CompanyPagedQueryDto } from '../../../common/dto/pagination-query.dto';

export class QueryThreeWayMatchDto extends CompanyPagedQueryDto {
  @IsOptional()
  @IsEnum(ThreeWayMatchStatus)
  status?: ThreeWayMatchStatus;
}

export class CreateThreeWayMatchDto {
  // matchNumber is server-generated via the entity-code generator; any client
  // value is ignored. Kept optional so older clients posting it still validate.
  @IsOptional()
  @IsString()
  matchNumber?: string;

  @IsString()
  companyId!: string;

  @IsString()
  purchaseOrderId!: string;

  @IsOptional()
  @IsString()
  goodsReceivedNoteId?: string;

  @IsOptional()
  @IsString()
  supplierInvoiceId?: string;

  @IsOptional()
  @IsDateString()
  matchDate?: string;

  @IsOptional()
  @IsEnum(ThreeWayMatchStatus)
  matchStatus?: ThreeWayMatchStatus;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  quantityVariance?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  amountVariance?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
