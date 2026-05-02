import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ExternalPaymentContext, ExternalPaymentStatus } from '@prisma/client';

export class QueryExternalPaymentDto {
  @IsOptional()
  @IsString()
  companyId?: string;

  @IsOptional()
  @IsString()
  providerId?: string;

  @IsOptional()
  @IsEnum(ExternalPaymentStatus)
  status?: ExternalPaymentStatus;

  @IsOptional()
  @IsEnum(ExternalPaymentContext)
  paymentContextType?: ExternalPaymentContext;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;
}
