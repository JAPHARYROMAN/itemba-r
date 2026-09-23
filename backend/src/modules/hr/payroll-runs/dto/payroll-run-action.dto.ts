import { IsDateString, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class PayPayrollRunDto {
  @IsUUID('all')
  cashDeskAccountId!: string;
  @IsUUID('all')
  requestId!: string;
  @IsDateString()
  businessDate!: string;
}

export class ReversePayrollPaymentDto {
  @IsUUID('all')
  movementId!: string;
  @IsDateString()
  businessDate!: string;
  @IsString()
  @Length(3, 500)
  reason!: string;
}

export class CancelPayrollRunDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
