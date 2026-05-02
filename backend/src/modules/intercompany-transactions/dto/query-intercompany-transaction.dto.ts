import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { InterCompanyTxStatus, InterCompanyTxType } from '@prisma/client';

export class QueryIntercompanyTransactionDto {
  @IsOptional() @IsString() fromCompanyId?: string;
  @IsOptional() @IsString() toCompanyId?: string;
  @IsOptional() @IsEnum(InterCompanyTxStatus) status?: InterCompanyTxStatus;
  @IsOptional() @IsEnum(InterCompanyTxType) type?: InterCompanyTxType;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) limit?: number = 20;
}
