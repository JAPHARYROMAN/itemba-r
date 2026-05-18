import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { BankAccountType, CurrencyCode } from '@prisma/client';

export class QueryBankAccountDto {
  @IsOptional() @IsString() companyId?: string;
  @IsOptional() @IsString() groupId?: string;
  /** Phase 1 — filter by Branch. */
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsEnum(BankAccountType) accountType?: BankAccountType;
  @IsOptional() @IsEnum(CurrencyCode) currency?: CurrencyCode;
  @IsOptional() @Transform(({ value }) => value === 'true') @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) limit?: number = 20;
}
