import { IsDateString, IsOptional, IsString } from 'class-validator';

export class GenerateSupplierStatementDto {
  @IsString()
  companyId!: string;

  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsDateString()
  periodStart!: string;

  @IsDateString()
  periodEnd!: string;
}
