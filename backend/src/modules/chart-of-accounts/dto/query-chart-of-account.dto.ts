import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { AccountType } from '@prisma/client';

export class QueryChartOfAccountDto {
  @IsOptional() @IsString() companyId?: string;
  @IsOptional() @IsString() divisionId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsEnum(AccountType) accountType?: AccountType;
  // @Type(() => String) keeps the value a string under enableImplicitConversion (see query-bank-account.dto.ts).
  @IsOptional() @Type(() => String) @Transform(({ value }) => value === 'true') @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number = 20;
}
