import { IsString, IsDateString, IsOptional } from 'class-validator';

export class GenerateReconciliationDto {
  @IsString()
  companyId!: string;

  @IsString()
  branchId!: string;

  @IsDateString()
  reconciliationDate!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
