import { IsOptional, IsString } from 'class-validator';

export class PayExpenseDto {
  @IsOptional()
  @IsString()
  cashAccountId?: string;

  @IsOptional()
  @IsString()
  paymentMethod?: string;
}
