import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { CashAccountType } from '@prisma/client';

export class QueryCashAccountDto {
  @IsOptional() @IsString() companyId?: string;
  @IsOptional() @IsString() divisionId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsEnum(CashAccountType) accountType?: CashAccountType;
  // @Type(() => String) keeps the value a string under enableImplicitConversion (see query-bank-account.dto.ts).
  @IsOptional()
  @Type(() => String)
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  isActive?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5000) limit?: number = 20;
}
