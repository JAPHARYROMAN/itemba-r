import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SalesPaymentMethod } from '@prisma/client';
import { MOBILE_POS_LITE_RECEIPT_METHODS } from './mobile-pos-terminal.dto';

export class MobilePosLiteSaleLineDto {
  @IsUUID()
  productId!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.0001)
  @Max(1000000)
  quantity!: number;
}

export class CreateMobilePosLiteSaleDto {
  @IsIn([...MOBILE_POS_LITE_RECEIPT_METHODS, SalesPaymentMethod.CREDIT])
  paymentMethod!: SalesPaymentMethod;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  paymentReference?: string;

  @IsString()
  @MinLength(16)
  @MaxLength(64)
  idempotencyKey!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MobilePosLiteSaleLineDto)
  lines!: MobilePosLiteSaleLineDto[];
}
