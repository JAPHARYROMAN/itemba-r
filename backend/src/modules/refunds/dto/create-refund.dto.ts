import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
} from 'class-validator';
import { CurrencyCode } from '@prisma/client';

/**
 * Create a DRAFT refund.
 *
 * A refund is issued against EITHER:
 *  - an existing ISSUED credit note (`creditNoteId`), refunding its value in
 *    cash / bank, OR
 *  - a customer overpayment / credit sitting on a receivable (`receivableId`).
 *
 * At least one source (creditNoteId or receivableId) must be supplied; the
 * service validates the source belongs to the company and enforces the
 * double-refund guard.
 */
export class CreateRefundDto {
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

  /** ISSUED credit note being refunded in cash. */
  @IsOptional()
  @IsString()
  creditNoteId?: string;

  /** Receivable carrying the customer overpayment / credit being refunded. */
  @IsOptional()
  @IsString()
  receivableId?: string;

  /** Cash / bank account the money leaves from. Resolves the GL credit line. */
  @IsNotEmpty()
  @IsString()
  cashAccountId!: string;

  /** Refund amount in the account currency. Must be > 0. */
  @IsNotEmpty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @IsOptional()
  @IsEnum(CurrencyCode)
  currency?: CurrencyCode;

  @IsNotEmpty()
  @IsDateString()
  refundDate!: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
