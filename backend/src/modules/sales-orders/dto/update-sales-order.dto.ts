import {
  IsArray,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SalesType, CurrencyCode, SalesPaymentMethod } from '@prisma/client';
import { SalesOrderLineDto } from './create-sales-order.dto';

export class UpdateSalesOrderDto {
  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  customerName?: string;

  @IsOptional()
  @IsEnum(SalesType)
  salesType?: SalesType;

  @IsOptional()
  @IsDateString()
  orderDate?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsEnum(CurrencyCode)
  currency?: CurrencyCode;

  @IsOptional()
  @IsString()
  notes?: string;

  /**
   * Order-level (document) discount. See CreateSalesOrderDto.documentDiscount.
   * Optional on update; when omitted the stored value is preserved.
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  documentDiscount?: number;

  @IsOptional()
  @IsString()
  divisionId?: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsString()
  salespersonId?: string;

  @IsOptional()
  @IsEnum(SalesPaymentMethod)
  paymentMethod?: SalesPaymentMethod;

  @IsOptional()
  @IsString()
  cashAccountId?: string;

  @IsOptional()
  @IsString()
  paymentReference?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SalesOrderLineDto)
  lines?: SalesOrderLineDto[];
}
