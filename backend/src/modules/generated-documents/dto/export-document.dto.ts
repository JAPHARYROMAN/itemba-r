import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { GenerateBusinessPdfDto } from './generate-business-pdf.dto';
import { GenerateTablePdfDto } from './generate-table-pdf.dto';
import { DOCUMENT_FORMATS, DocumentFormat } from '../document-renderer';

export class ExportBusinessDocumentDto extends GenerateBusinessPdfDto {
  @IsIn(DOCUMENT_FORMATS)
  format!: DocumentFormat;
}

export class ExportTableDocumentDto extends GenerateTablePdfDto {
  @IsIn(DOCUMENT_FORMATS)
  format!: DocumentFormat;
}

export class ExportLetterDto {
  @IsIn(['pdf', 'docx', 'txt'])
  format!: 'pdf' | 'docx' | 'txt';

  @IsOptional()
  @IsString()
  companyId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(30000)
  body!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  recipient?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  signatory?: string;
}
