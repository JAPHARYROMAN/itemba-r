import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { BankAccountType, CurrencyCode } from '@prisma/client';

export class CreateBankAccountDto {
  @IsOptional()
  @IsString()
  companyId?: string;

  @IsOptional()
  @IsString()
  groupId?: string;

  @IsNotEmpty()
  @IsString()
  bankName!: string;

  @IsOptional()
  @IsString()
  branchName?: string;

  @IsNotEmpty()
  @IsString()
  accountName!: string;

  @IsNotEmpty()
  @IsString()
  accountNumber!: string;

  @IsOptional()
  @IsEnum(BankAccountType)
  accountType?: BankAccountType;

  @IsOptional()
  @IsEnum(CurrencyCode)
  currency?: CurrencyCode;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @IsOptional()
  @IsString()
  openedDate?: string;

  @IsOptional()
  @IsString()
  swiftCode?: string;

  @IsOptional()
  @IsString()
  bankAddress?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
