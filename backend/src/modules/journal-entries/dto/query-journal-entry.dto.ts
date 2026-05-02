import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { JournalEntryStatus } from '@prisma/client';

export class QueryJournalEntryDto {
  @IsOptional() @IsString() companyId?: string;
  @IsOptional() @IsEnum(JournalEntryStatus) status?: JournalEntryStatus;
  @IsOptional() @IsString() accountingPeriodId?: string;
  @IsOptional() @IsString() dateFrom?: string;
  @IsOptional() @IsString() dateTo?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) limit?: number = 20;
}
