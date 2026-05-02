import { IsString, IsOptional, IsNumber, IsEnum, Min, Max } from 'class-validator';
import { SalesCommissionBasisDto } from './create-sales-commission.dto';

export class UpdateSalesCommissionDto {
  @IsOptional()
  @IsEnum(SalesCommissionBasisDto)
  basis?: SalesCommissionBasisDto;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  rate?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
