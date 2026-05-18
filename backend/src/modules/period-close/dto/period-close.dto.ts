import { IsOptional, IsString } from 'class-validator';
import { CompanyPagedQueryDto } from '../../../common/dto/pagination-query.dto';

export class QueryPeriodCloseDto extends CompanyPagedQueryDto {}

export class CreatePeriodCloseDto {
  @IsString()
  closeNumber!: string;

  @IsString()
  companyId!: string;

  @IsString()
  fiscalYearId!: string;

  @IsString()
  accountingPeriodId!: string;

  @IsOptional()
  @IsString()
  reviewNotes?: string;
}
