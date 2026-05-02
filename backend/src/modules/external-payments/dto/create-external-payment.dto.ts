import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import {
  ExternalPaymentContext,
  ExternalPaymentMethod,
} from '@prisma/client';

export class CreateExternalPaymentDto {
  @IsNotEmpty()
  @IsString()
  companyId!: string;

  @IsOptional()
  @IsString()
  providerId?: string;

  @IsOptional()
  @IsString()
  connectionId?: string;

  @IsOptional()
  @IsEnum(ExternalPaymentContext)
  paymentContextType?: ExternalPaymentContext;

  @IsOptional()
  @IsString()
  paymentContextId?: string;

  @IsOptional()
  @IsString()
  externalReference?: string;

  @IsOptional()
  @IsString()
  payerName?: string;

  @IsOptional()
  @IsString()
  payerPhone?: string;

  @IsNotEmpty()
  @IsNumber()
  amount!: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsEnum(ExternalPaymentMethod)
  paymentMethod?: ExternalPaymentMethod;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}
