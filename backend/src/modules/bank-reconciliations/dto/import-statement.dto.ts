import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
class StatementRowDto {
  @IsString() @MaxLength(10) transactionDate!: string;
  @IsString() @MaxLength(500) description!: string;
  @IsOptional() @IsString() @MaxLength(200) reference?: string;
  @IsString() @MaxLength(20) debitAmount!: string;
  @IsString() @MaxLength(20) creditAmount!: string;
}
export class ImportStatementDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => StatementRowDto)
  rows!: StatementRowDto[];
}
