import { IsEmail, IsOptional } from 'class-validator';
import { ExportStatementDto } from './export-statement.dto';

/**
 * Body for POST /customer-statements/email — emails a rendered PDF statement to
 * the customer. Recipient defaults to the customer's on-file email; `to` may
 * override it. Delivery is best-effort: if SMTP is not configured the shared
 * EmailService no-ops and logs, so this endpoint still returns 2xx with
 * `emailed: false`.
 */
export class EmailStatementDto extends ExportStatementDto {
  /** Override recipient; defaults to the customer's stored email address. */
  @IsOptional()
  @IsEmail()
  to?: string;
}
