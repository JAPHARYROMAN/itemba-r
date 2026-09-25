import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const RECORD_KINDS = ['DEBTOR', 'CREDITOR', 'SALE', 'PURCHASE', 'EXPENSE', 'NOTE'] as const;
export class RecordsQuery {
  @IsOptional() @IsIn(RECORD_KINDS) kind?: string;
  @IsOptional() @IsUUID() companyId?: string;
  @IsOptional() @IsUUID() divisionId?: string;
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsIn(['all', 'personal']) scope?: string;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsIn(['all', 'open', 'settled', 'overdue', 'void']) status?: string;
  @IsOptional() @Matches(/^[A-Z]{3}$/) currency?: string;
  @IsOptional() @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @IsOptional() @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
}
export class RecordValuesDto {
  @IsIn(RECORD_KINDS) kind!: string;
  @IsString() @MinLength(1) @MaxLength(180) title!: string;
  @IsOptional() @IsString() @MaxLength(180) counterparty?: string;
  @IsOptional() @IsString() @MaxLength(160) contact?: string;
  @IsOptional() @IsString() @MaxLength(100) reference?: string;
  @IsOptional() @IsString() @MaxLength(80) category?: string;
  @IsOptional() @IsString() @MaxLength(10000) notes?: string;
  @IsOptional() @IsUUID() companyId?: string | null;
  @IsOptional() @IsUUID() divisionId?: string | null;
  @IsOptional() @IsUUID() branchId?: string | null;
  @IsIn(['TZS', 'KES', 'UGX', 'USD', 'EUR', 'GBP']) currency!: string;
  @Matches(/^\d{1,12}(\.\d{1,2})?$/) amount!: string;
  @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) recordDate!: string;
  @IsOptional() @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) dueDate?:
    | string
    | null;
}
export class CreateRecordDto extends RecordValuesDto {
  @IsUUID() requestId!: string;
}
export class UpdateRecordDto extends RecordValuesDto {
  @IsInt() @Min(1) version!: number;
}
export class RecordSettlementDto {
  @IsUUID() requestId!: string;
  @IsInt() @Min(1) version!: number;
  @Matches(/^\d{1,12}(\.\d{1,2})?$/) amount!: string;
  @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;
  @IsOptional() @IsString() @MaxLength(160) reference?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}
export class RecordReasonDto {
  @IsInt() @Min(1) version!: number;
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
}
export class RecordStatementQuery {
  @IsOptional() @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @IsOptional() @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
  @IsOptional() @IsIn(['pdf', 'csv']) format?: string;
}
