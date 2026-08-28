import { IsArray, IsIn, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';
import { PickType } from '@nestjs/swagger';

/**
 * Validated payload for the print-engine render endpoints (render / render-pdf /
 * render-excel). Superset of the fields the three handlers read; only templateId
 * is required. `data`, `pdfSections`, and `sheetData` carry caller-supplied
 * report content and are intentionally loosely typed (validated as object/array
 * shape, not deep-validated). Replaces the previous `@Body() dto: any`, which let
 * arbitrary unvalidated JSON reach the template renderer.
 */
export class RenderDocumentDto {
  @IsString()
  @IsNotEmpty()
  templateId!: string;

  @IsOptional()
  @IsString()
  entityType?: string;

  @IsOptional()
  @IsString()
  entityId?: string;

  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;

  @IsOptional()
  @IsIn(['HTML', 'PDF', 'TEXT', 'JSON'])
  outputFormat?: string;

  @IsOptional()
  @IsArray()
  pdfSections?: unknown[];

  @IsOptional()
  @IsArray()
  sheetData?: Record<string, unknown>[];

  @IsOptional()
  @IsString()
  sheetName?: string;
}

/** Strict subset consumed by the non-binary `/render` operation. */
export class RenderInlineDocumentDto extends PickType(RenderDocumentDto, [
  'templateId',
  'entityType',
  'entityId',
  'data',
  'outputFormat',
] as const) {}
