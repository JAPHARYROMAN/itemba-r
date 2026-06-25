import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { FiscalPeriodStatus } from '@prisma/client';

export class QueryFiscalYearDto {
  @IsOptional() @IsString() companyId?: string;
  @IsOptional() @IsEnum(FiscalPeriodStatus) status?: FiscalPeriodStatus;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5000) limit?: number = 20;
}
