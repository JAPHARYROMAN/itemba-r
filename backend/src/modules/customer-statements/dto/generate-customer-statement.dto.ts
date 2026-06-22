import { IsDateString, IsOptional, IsString } from 'class-validator';

export class GenerateCustomerStatementDto {
  @IsString()
  companyId!: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsDateString()
  periodStart!: string;

  @IsDateString()
  periodEnd!: string;
}
