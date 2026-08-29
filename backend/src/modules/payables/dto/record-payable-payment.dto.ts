import { IsDateString, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class RecordPayablePaymentDto {
  @IsNotEmpty()
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsDateString()
  paymentDate?: string;

  /**
   * Cash / bank account the money leaves when paying the supplier. When
   * supplied it must belong to the same company; its accountType selects the
   * GL credit line (BANK -> BANK role, otherwise CASH_ON_HAND) AND the
   * specific CashAccount.currentBalance subledger cache that is decremented in
   * the same transaction. Optional and backward compatible: legacy callers
   * that omit it fall back to CASH_ON_HAND so the settlement journal
   * (DR AP control / CR Cash) still balances (but with no CashAccount row to
   * relieve).
   */
  @IsOptional()
  @IsString()
  cashAccountId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
