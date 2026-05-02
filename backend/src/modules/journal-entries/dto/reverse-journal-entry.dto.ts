import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ReverseJournalEntryDto {
  @IsNotEmpty()
  @IsString()
  reversalReason!: string;

  @IsOptional()
  @IsString()
  transactionDate?: string;

  @IsOptional()
  @IsString()
  accountingPeriodId?: string;
}
