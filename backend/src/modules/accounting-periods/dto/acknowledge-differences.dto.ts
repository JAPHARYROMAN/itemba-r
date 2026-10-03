import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Party linkage (Phase 3): closing a period whose control accounts differ from the
 * sub-ledger requires a reason; it is audited with the close and never changes a balance.
 */
export class AcknowledgeDifferencesDto {
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}
