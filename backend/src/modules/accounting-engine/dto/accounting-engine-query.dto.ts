import { IsOptional, IsString } from 'class-validator';

export class AccountingEngineSummaryQueryDto {
  @IsOptional()
  @IsString()
  companyId?: string;
}
