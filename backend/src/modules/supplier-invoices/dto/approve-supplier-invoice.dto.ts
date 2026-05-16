import { Type } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

export class ApproveSupplierInvoiceDto {
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  allowVariance?: boolean;
}
