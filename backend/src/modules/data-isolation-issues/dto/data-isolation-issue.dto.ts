import { IsEnum, IsOptional } from 'class-validator';
import { DataIsolationIssueSeverity, DataIsolationIssueStatus, DataIsolationIssueType } from '@prisma/client';
import { PageSizeQueryDto } from '../../../common/dto/pagination-query.dto';

export class QueryDataIsolationIssueDto extends PageSizeQueryDto {
  @IsOptional()
  @IsEnum(DataIsolationIssueStatus)
  status?: DataIsolationIssueStatus;

  @IsOptional()
  @IsEnum(DataIsolationIssueSeverity)
  severity?: DataIsolationIssueSeverity;

  @IsOptional()
  @IsEnum(DataIsolationIssueType)
  issueType?: DataIsolationIssueType;
}
