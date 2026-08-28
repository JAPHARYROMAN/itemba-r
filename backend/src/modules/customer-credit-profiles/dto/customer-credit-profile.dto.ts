import { CreditRiskRating, CreditStatus } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class UpdateCustomerCreditProfileDto {
  @IsOptional()
  @IsNumber()
  creditLimit?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsInt()
  paymentTermsDays?: number | null;

  @IsOptional()
  @IsEnum(CreditRiskRating)
  riskRating?: CreditRiskRating;

  @IsOptional()
  @IsEnum(CreditStatus)
  creditStatus?: CreditStatus;

  @IsOptional()
  @IsNumber()
  currentOutstanding?: number;

  @IsOptional()
  @IsNumber()
  overdueAmount?: number;

  @IsOptional()
  @IsDateString()
  lastReviewedAt?: string | null;

  @IsOptional()
  @IsUUID()
  reviewedById?: string | null;

  @IsOptional()
  @IsString()
  notes?: string | null;
}

export class CreateCustomerCreditProfileDto extends UpdateCustomerCreditProfileDto {
  @IsUUID()
  companyId!: string;

  @IsUUID()
  customerId!: string;
}
