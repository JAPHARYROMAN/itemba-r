import {
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SalesType, CurrencyCode, SalesPaymentMethod } from '@prisma/client';

export class SalesOrderLineDto {
  @IsNotEmpty()
  @IsString()
  productId!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNotEmpty()
  @IsNumber()
  quantity!: number;

  @IsNotEmpty()
  @IsString()
  unitId!: string;

  @IsNotEmpty()
  @IsNumber()
  unitPrice!: number;

  @IsOptional()
  @IsNumber()
  discountAmount?: number;

  @IsOptional()
  @IsNumber()
  taxAmount?: number;

  /** Optional FK to a specific ProductBatch — for FIFO/expiry tracking. */
  @IsOptional()
  @IsString()
  batchId?: string;
}

export class CreateSalesOrderDto {
  @IsNotEmpty()
  @IsString()
  companyId!: string;

  @IsOptional()
  @IsString()
  divisionId?: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  customerName?: string;

  @IsNotEmpty()
  @IsEnum(SalesType)
  salesType!: SalesType;

  @IsNotEmpty()
  @IsDateString()
  orderDate!: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsNotEmpty()
  @IsEnum(CurrencyCode)
  currency!: CurrencyCode;

  @IsOptional()
  @IsString()
  notes?: string;

  /**
   * Optional FK to the employee credited as salesperson. Used by the
   * commission flow — confirming the order auto-creates a DRAFT
   * SalesCommission when the salesperson has a `defaultCommissionRate` set.
   */
  @IsOptional()
  @IsString()
  salespersonId?: string;

  /**
   * How the customer is paying. CREDIT => Receivable created on confirm.
   * Other methods => `cashAccountId` is credited immediately on confirm.
   */
  @IsOptional()
  @IsEnum(SalesPaymentMethod)
  paymentMethod?: SalesPaymentMethod;

  /** Cash/bank account credited on confirm for non-CREDIT payments. */
  @IsOptional()
  @IsString()
  cashAccountId?: string;

  /** Mobile-money confirmation code, card slip ref, etc. */
  @IsOptional()
  @IsString()
  paymentReference?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SalesOrderLineDto)
  lines!: SalesOrderLineDto[];
}
