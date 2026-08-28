import { RFQSupplierResponseStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class RfqSupplierDto {
  @IsUUID('all')
  supplierId!: string;

  @IsOptional()
  @IsDateString()
  sentAt?: string;

  @IsOptional()
  @IsEnum(RFQSupplierResponseStatus)
  responseStatus?: RFQSupplierResponseStatus;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateRfqDto {
  @IsOptional()
  @IsString()
  rfqNumber?: string;

  @IsUUID('all')
  companyId!: string;

  @IsOptional()
  @IsUUID('all')
  purchaseRequisitionId?: string;

  @IsOptional()
  @IsDateString()
  rfqDate?: string;

  @IsOptional()
  @IsDateString()
  closingDate?: string;

  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RfqSupplierDto)
  rfqSuppliers?: RfqSupplierDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RfqSupplierDto)
  suppliers?: RfqSupplierDto[];
}

export class UpdateRfqDto {
  @IsOptional()
  @IsUUID('all')
  companyId?: string;

  @IsOptional()
  @IsUUID('all')
  purchaseRequisitionId?: string;

  @IsOptional()
  @IsDateString()
  rfqDate?: string;

  @IsOptional()
  @IsDateString()
  closingDate?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class SendRfqDto {
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  supplierIds?: string[];
}
