import { FinancialStatementType } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';

export class GenerateFinancialStatementDto {
  @IsUUID()
  companyId!: string;

  @IsOptional()
  @IsEnum(FinancialStatementType)
  statementType?: FinancialStatementType;

  @IsDateString()
  periodStart!: string;

  @IsDateString()
  periodEnd!: string;
}
