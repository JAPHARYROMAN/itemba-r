import { IsEnum, IsOptional } from 'class-validator';
import { AnalyticsRunStatus, AnalyticsRunType } from '@prisma/client';
import { CompanyPagedQueryDto } from '../../../common/dto/pagination-query.dto';

export class QueryAnalyticsSnapshotRunDto extends CompanyPagedQueryDto {
  @IsOptional()
  @IsEnum(AnalyticsRunType)
  runType?: AnalyticsRunType;

  @IsOptional()
  @IsEnum(AnalyticsRunStatus)
  status?: AnalyticsRunStatus;
}
