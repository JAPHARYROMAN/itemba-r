import { IsDateString, IsOptional, IsString } from 'class-validator';

/**
 * Body for the statement export endpoints (POST /customer-statements/export/pdf
 * and /export/excel). Same company+customer+range selection as the detail
 * endpoint. `templateId` is OPTIONAL: when supplied the render is delegated to
 * the print-engine (which fills the stored DocumentTemplate and persists a
 * GeneratedDocument); when omitted the module renders a built-in statement
 * layout with the same pdfkit / exceljs libraries so export never hard-depends
 * on a seeded template.
 */
export class ExportStatementDto {
  @IsString()
  companyId!: string;

  @IsString()
  customerId!: string;

  @IsDateString()
  dateFrom!: string;

  @IsDateString()
  dateTo!: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  templateId?: string;
}
