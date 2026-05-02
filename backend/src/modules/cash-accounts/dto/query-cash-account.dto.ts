import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { CashAccountType } from '@prisma/client';

export class QueryCashAccountDto {
  @IsOptional() @IsString() companyId?: string;
  @IsOptional() @IsEnum(CashAccountType) accountType?: CashAccountType;
  @IsOptional() @Transform(({ value }) => value === 'true') @IsBoolean() isActive?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) limit?: number = 20;
}
