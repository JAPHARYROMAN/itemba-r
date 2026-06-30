import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { BankAccountType, CurrencyCode } from '@prisma/client';

export class QueryBankAccountDto {
  @IsOptional() @IsString() companyId?: string;
  @IsOptional() @IsString() divisionId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() groupId?: string;
  @IsOptional() @IsEnum(BankAccountType) accountType?: BankAccountType;
  @IsOptional() @IsEnum(CurrencyCode) currency?: CurrencyCode;
  // `@Type(() => String)` is required so the global pipe's enableImplicitConversion
  // doesn't coerce the string to boolean `true` before @Transform runs. See
  // query-product-category.dto.ts for the full explanation.
  @IsOptional()
  @Type(() => String)
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  isActive?: boolean;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5000) limit?: number = 20;
}
