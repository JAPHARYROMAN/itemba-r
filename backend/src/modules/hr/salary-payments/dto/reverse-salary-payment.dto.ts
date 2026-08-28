import { IsOptional, IsString } from 'class-validator';

export class ReverseSalaryPaymentDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
