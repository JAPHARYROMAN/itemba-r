import { IsEnum, IsNotEmpty } from 'class-validator';
import { LoanStatus } from '@prisma/client';

export class MarkLoanStatusDto {
  @IsNotEmpty() @IsEnum(LoanStatus) status!: LoanStatus;
}
