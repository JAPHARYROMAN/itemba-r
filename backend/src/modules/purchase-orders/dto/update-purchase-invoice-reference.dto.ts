import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdatePurchaseInvoiceReferenceDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  supplierInvoiceNumber?: string | null;

  @IsOptional()
  @IsDateString()
  supplierInvoiceDate?: string | null;
}
