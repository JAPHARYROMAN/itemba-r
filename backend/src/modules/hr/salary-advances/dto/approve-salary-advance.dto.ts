import { IsNumber, IsOptional, IsPositive } from 'class-validator';

export class ApproveSalaryAdvanceDto {
  @IsOptional()
  @IsNumber()
  @IsPositive()
  approvedAmount?: number;
}
