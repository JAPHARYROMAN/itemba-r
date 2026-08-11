import { IsEnum, IsOptional, IsString } from 'class-validator';
import { GRNStatus } from '@prisma/client';
import { CompanyPagedQueryDto } from '../../../common/dto/pagination-query.dto';

export class QueryGoodsReceivedNotesDto extends CompanyPagedQueryDto {
  @IsOptional()
  @IsString()
  divisionId?: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsEnum(GRNStatus)
  status?: GRNStatus;

  @IsOptional()
  @IsString()
  supplierId?: string;

  /** Free-text search across the GRN number and the supplier name. */
  @IsOptional()
  @IsString()
  search?: string;
}
