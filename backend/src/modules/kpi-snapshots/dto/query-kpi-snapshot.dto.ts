import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { SnapshotPeriodType } from '@prisma/client';
import { CompanyPagedQueryDto } from '../../../common/dto/pagination-query.dto';

export class QueryKpiSnapshotDto extends CompanyPagedQueryDto {
  @IsOptional()
  @IsString()
  kpiIndicatorId?: string;

  @IsOptional()
  @IsEnum(SnapshotPeriodType)
  periodType?: SnapshotPeriodType;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
