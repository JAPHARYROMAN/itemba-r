import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { MobilePosTerminalStatus, SalesPaymentMethod } from '@prisma/client';

export const MOBILE_POS_LITE_RECEIPT_METHODS = [
  SalesPaymentMethod.CASH,
  SalesPaymentMethod.MOBILE_MONEY,
  SalesPaymentMethod.BANK_TRANSFER,
] as const;

export class MobilePosTerminalPaymentDto {
  @IsIn(MOBILE_POS_LITE_RECEIPT_METHODS)
  paymentMethod!: (typeof MOBILE_POS_LITE_RECEIPT_METHODS)[number];

  @IsUUID()
  cashAccountId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  label?: string;
}

export class CreateMobilePosTerminalDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsUUID()
  companyId!: string;

  @IsUUID()
  divisionId!: string;

  @IsUUID()
  branchId!: string;

  @IsUUID()
  salespersonId!: string;

  @IsUUID()
  generalCustomerId!: string;

  @IsOptional()
  @IsBoolean()
  creditEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  offlineCashEnabled?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MobilePosTerminalPaymentDto)
  paymentMethods!: MobilePosTerminalPaymentDto[];
}

export class UpdateMobilePosTerminalDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsUUID()
  salespersonId?: string;

  @IsOptional()
  @IsUUID()
  generalCustomerId?: string;

  @IsOptional()
  @IsBoolean()
  creditEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  offlineCashEnabled?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MobilePosTerminalPaymentDto)
  paymentMethods?: MobilePosTerminalPaymentDto[];
}

export class UpdateMobilePosTerminalStatusDto {
  @IsEnum(MobilePosTerminalStatus)
  status!: MobilePosTerminalStatus;
}

export class QueryMobilePosTerminalDto {
  @IsOptional()
  @IsUUID()
  companyId?: string;
}
