import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { AccountType } from '@prisma/client';

export class CreateChartOfAccountDto {
  @IsNotEmpty()
  @IsString()
  companyId!: string;

  @IsNotEmpty()
  @IsString()
  accountCode!: string;

  @IsNotEmpty()
  @IsString()
  accountName!: string;

  @IsNotEmpty()
  @IsEnum(AccountType)
  accountType!: AccountType;

  @IsOptional()
  @IsString()
  accountSubType?: string;

  @IsOptional()
  @IsString()
  parentAccountId?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isSystemAccount?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
