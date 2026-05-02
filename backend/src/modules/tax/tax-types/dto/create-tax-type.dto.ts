import { IsString, IsOptional, IsEnum, IsBoolean } from 'class-validator';
import { TaxCategory, TaxCodeStatus } from '@prisma/client';

export class CreateTaxTypeDto {
  @IsString() taxTypeCode!: string;
  @IsString() name!: string;
  @IsOptional() @IsEnum(TaxCategory) taxCategory?: TaxCategory;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsBoolean() isRecoverable?: boolean;
  @IsOptional() @IsBoolean() isWithholding?: boolean;
  @IsOptional() @IsBoolean() appliesToSales?: boolean;
  @IsOptional() @IsBoolean() appliesToPurchases?: boolean;
  @IsOptional() @IsBoolean() appliesToPayroll?: boolean;
  @IsOptional() @IsBoolean() appliesToExpenses?: boolean;
  @IsOptional() @IsEnum(TaxCodeStatus) status?: TaxCodeStatus;
}
