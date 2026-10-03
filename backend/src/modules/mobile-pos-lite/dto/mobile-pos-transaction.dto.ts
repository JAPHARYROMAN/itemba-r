import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
export class PosPaymentDto {
  @IsIn(['CASH', 'MOBILE_MONEY', 'BANK_TRANSFER']) method!:
    | 'CASH'
    | 'MOBILE_MONEY'
    | 'BANK_TRANSFER';
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) amount!: number;
  @IsOptional() @IsString() @MaxLength(120) reference?: string;
}
export class PosCollectionDto extends PosPaymentDto {
  @IsString() @MinLength(16) @MaxLength(64) requestId!: string;
}
export class PosReturnLineDto {
  @IsUUID() lineId!: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) quantity!: number;
  @IsIn(['RESTOCK', 'DAMAGED']) disposition!: 'RESTOCK' | 'DAMAGED';
}
export class PosReturnDto {
  @IsString() @MinLength(16) @MaxLength(64) requestId!: string;
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
  @IsOptional() @IsIn(['CASH', 'MOBILE_MONEY', 'BANK_TRANSFER']) refundMethod?:
    | 'CASH'
    | 'MOBILE_MONEY'
    | 'BANK_TRANSFER';
  @IsOptional() @IsString() @MaxLength(120) reference?: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PosReturnLineDto)
  lines!: PosReturnLineDto[];
}
