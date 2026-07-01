import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { CreditNoteStatus } from '../credit-note-status.enum';

export class QueryCreditNoteDto {
  @IsOptional() @IsString() companyId?: string;
  @IsOptional() @IsString() divisionId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsEnum(CreditNoteStatus) status?: CreditNoteStatus;
  @IsOptional() @IsString() customerId?: string;
  @IsOptional() @IsString() salesOrderId?: string;
  @IsOptional() @IsString() receivableId?: string;
  @IsOptional() @IsString() dateFrom?: string;
  @IsOptional() @IsString() dateTo?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5000) limit?: number = 20;
}
