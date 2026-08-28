import { IsOptional, IsString } from 'class-validator';

export class CancelSalesCommissionDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
