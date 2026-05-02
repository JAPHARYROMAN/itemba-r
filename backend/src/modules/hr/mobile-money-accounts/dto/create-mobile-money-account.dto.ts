import { IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { MobileMoneyAccountStatus, MobileMoneyProvider } from '@prisma/client';

/**
 * Tanzanian mobile-money MSISDN. Accepts E.164 (`+255712345678`) or the
 * national 0-prefixed form (`0712345678`). Service normalises before storage.
 */
const MSISDN_REGEX = /^(\+?255|0)\d{9}$/;

export class CreateMobileMoneyAccountDto {
  @IsNotEmpty()
  @IsString()
  employeeId!: string;

  @IsNotEmpty()
  @IsEnum(MobileMoneyProvider)
  provider!: MobileMoneyProvider;

  @IsNotEmpty()
  @IsString()
  @Matches(MSISDN_REGEX, {
    message: 'msisdn must be a Tanzanian mobile number — +255XXXXXXXXX or 0XXXXXXXXX',
  })
  msisdn!: string;

  @IsOptional()
  @IsString()
  accountName?: string;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @IsOptional()
  @IsEnum(MobileMoneyAccountStatus)
  status?: MobileMoneyAccountStatus;

  @IsOptional()
  @IsString()
  notes?: string;
}
