import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { CurrencyCode, SupplierOrderDraftStatus } from '@prisma/client';

export class SupplierOrderDraftLineDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  itemCode?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  description!: string;

  @IsNumber()
  @Min(0.0001)
  quantity!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  unitLabel!: string;

  @IsOptional()
  @IsNumber()
  @Min(0.0001)
  unitPrice?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  discountAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  taxAmount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class CreateSupplierOrderDraftDto {
  @IsString()
  @IsNotEmpty()
  companyId!: string;

  @IsOptional()
  @IsString()
  divisionId?: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(250)
  supplierName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  supplierAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(250)
  supplierContact?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  supplierTin?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  supplierVrn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  supplierPhone?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(250)
  supplierEmail?: string;

  @IsDateString()
  draftDate!: string;

  @IsOptional()
  @IsDateString()
  neededBy?: string;

  @IsEnum(CurrencyCode)
  currency!: CurrencyCode;

  @IsOptional()
  @IsString()
  @MaxLength(250)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  deliveryInstructions?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  terms?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SupplierOrderDraftLineDto)
  lines!: SupplierOrderDraftLineDto[];
}

export class UpdateSupplierOrderDraftDto extends CreateSupplierOrderDraftDto {}

export class QuerySupplierOrderDraftDto {
  @IsOptional() @IsString() companyId?: string;
  @IsOptional() @IsString() divisionId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() supplierId?: string;
  @IsOptional() @IsEnum(SupplierOrderDraftStatus) status?: SupplierOrderDraftStatus;
  @IsOptional() @IsDateString() dateFrom?: string;
  @IsOptional() @IsDateString() dateTo?: string;
  @IsOptional() @IsString() @MaxLength(200) search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}

export class SupplierOrderDraftExportAuditDto {
  @IsIn(['PDF', 'PRINT', 'DOWNLOAD', 'NATIVE_SHARE', 'WHATSAPP', 'EMAIL'])
  format!: 'PDF' | 'PRINT' | 'DOWNLOAD' | 'NATIVE_SHARE' | 'WHATSAPP' | 'EMAIL';
}

export class SupplierOrderDraftEmailDto {
  @IsEmail()
  @MaxLength(250)
  to!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsEmail({}, { each: true })
  cc?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  subject?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;
}
