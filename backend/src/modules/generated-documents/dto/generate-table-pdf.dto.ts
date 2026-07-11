import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  Validate,
  ValidateNested,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

export const TABLE_PDF_MAX_COLUMNS = 40;
export const TABLE_PDF_MAX_ROWS = 5000;

/**
 * class-validator's `each` option only reaches one array level, so the
 * rows matrix (string[][]) is validated with this custom constraint: every
 * row must be an array of strings exactly `columns.length` cells wide.
 */
@ValidatorConstraint({ name: 'tablePdfRowsMatchColumns', async: false })
export class TablePdfRowsMatchColumnsConstraint implements ValidatorConstraintInterface {
  validate(rows: unknown, args: ValidationArguments): boolean {
    const dto = args.object as GenerateTablePdfDto;
    if (!Array.isArray(dto.columns) || !Array.isArray(rows)) return false;
    const width = dto.columns.length;
    return rows.every(
      (row) =>
        Array.isArray(row) && row.length === width && row.every((cell) => typeof cell === 'string'),
    );
  }

  defaultMessage(): string {
    return 'each row must be an array of strings with exactly columns.length cells';
  }
}

export class TablePdfMetaEntryDto {
  @IsString()
  @MaxLength(60)
  label!: string;

  @IsString()
  @MaxLength(200)
  value!: string;
}

export class GenerateTablePdfDto {
  @IsString()
  @MaxLength(120)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  subtitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  status?: string;

  @IsOptional()
  @IsIn(['portrait', 'landscape'])
  orientation?: 'portrait' | 'landscape';

  @IsOptional()
  @IsString()
  companyId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(TABLE_PDF_MAX_COLUMNS)
  @IsString({ each: true })
  columns!: string[];

  @IsArray()
  @ArrayMaxSize(TABLE_PDF_MAX_ROWS)
  @Validate(TablePdfRowsMatchColumnsConstraint)
  rows!: string[][];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => TablePdfMetaEntryDto)
  meta?: TablePdfMetaEntryDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(TABLE_PDF_MAX_COLUMNS)
  @IsInt({ each: true })
  @Min(0, { each: true })
  numericColumns?: number[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(TABLE_PDF_MAX_COLUMNS)
  @IsNumber({}, { each: true })
  @Min(0.1, { each: true })
  columnWeights?: number[];

  @IsOptional()
  @IsBoolean()
  stripedRows?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  sectionTitle?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(16)
  @ValidateNested({ each: true })
  @Type(() => TablePdfMetaEntryDto)
  summary?: TablePdfMetaEntryDto[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  baseName?: string;
}
