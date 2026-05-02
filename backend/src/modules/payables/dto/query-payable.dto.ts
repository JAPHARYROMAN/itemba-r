import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { PayableStatus } from '@prisma/client';

export class QueryPayableDto {
  @IsOptional() @IsString() companyId?: string;
  @IsOptional() @IsEnum(PayableStatus) status?: PayableStatus;
  @IsOptional() @IsString() supplierId?: string;
  @IsOptional() @IsString() dateFrom?: string;
  @IsOptional() @IsString() dateTo?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) limit?: number = 20;
}
