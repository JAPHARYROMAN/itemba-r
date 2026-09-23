import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEmail,
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

export class DeskQuery {
  @IsOptional() @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @IsOptional() @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
  @IsOptional() @IsUUID() companyId?: string;
  @IsOptional() @IsUUID() divisionId?: string;
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsUUID() supplierId?: string;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional()
  @IsIn(['all', 'unpaid', 'partial', 'paid', 'overdue', 'due', 'void'])
  status?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
}
export class DeskSupplierDto {
  @IsUUID() companyId!: string;
  @IsString() @MinLength(1) @MaxLength(160) name!: string;
  @IsOptional() @IsEmail() @MaxLength(254) email?: string;
  @IsOptional() @IsString() @MaxLength(60) phone?: string;
}
export class DeskInvoiceDto {
  @IsUUID() companyId!: string;
  @IsUUID() divisionId!: string;
  @IsUUID() branchId!: string;
  @IsUUID() supplierId!: string;
  @IsString() @MinLength(1) @MaxLength(100) invoiceNumber!: string;
  @IsString() @MinLength(1) @MaxLength(500) description!: string;
  @IsIn(['TZS', 'KES', 'UGX', 'USD', 'EUR', 'GBP']) currency!: string;
  @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) invoiceDate!: string;
  @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) dueDate!: string;
  @Matches(/^\d{1,16}(\.\d{1,2})?$/) totalAmount!: string;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string;
}
export class DeskVersionDto {
  @IsInt() @Min(1) version!: number;
}
export class DeskPaymentDto extends DeskVersionDto {
  @IsUUID() requestId!: string;
  @Matches(/^\d{1,16}(\.\d{1,2})?$/) amount!: string;
  @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) paymentDate!: string;
  @IsIn(['Bank transfer', 'Cash', 'Mobile money', 'Cheque', 'Other']) method!: string;
  @IsString() @MaxLength(160) reference!: string;
}

export class DeskEditDto extends DeskVersionDto {
  @IsString() @MinLength(1) @MaxLength(100) invoiceNumber!: string;
  @IsString() @MinLength(1) @MaxLength(500) description!: string;
  @IsIn(['TZS', 'KES', 'UGX', 'USD', 'EUR', 'GBP']) currency!: string;
  @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) invoiceDate!: string;
  @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) dueDate!: string;
  @Matches(/^\d{1,16}(\.\d{1,2})?$/) totalAmount!: string;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string;
}
export class DeskReasonDto extends DeskVersionDto {
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
}
