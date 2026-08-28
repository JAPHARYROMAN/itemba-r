import { IsOptional, IsString, IsUUID } from 'class-validator';

export class PayPayrollRunDto {
  @IsOptional()
  @IsUUID('all')
  disbursingChartOfAccountId?: string;
}

export class CancelPayrollRunDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
