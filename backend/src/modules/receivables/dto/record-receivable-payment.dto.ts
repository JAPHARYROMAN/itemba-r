import {
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class RecordReceivablePaymentDto {
  @IsOptional()
  @IsUUID()
  requestId?: string;

  @IsNotEmpty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  // The service requires a date for retryable requests; older callers may omit both.
  @IsOptional()
  @IsDateString()
  paymentDate?: string;

  /**
   * Cash / bank account the collected money lands in. When supplied it must
   * belong to the same company; its accountType selects the GL debit line
   * (BANK -> BANK role, otherwise CASH_ON_HAND). Optional and backward
   * compatible: legacy callers that omit it fall back to CASH_ON_HAND so the
   * settlement journal (DR Cash / CR AR control) still balances.
   */
  @IsOptional()
  @IsString()
  cashAccountId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
