import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

class CreditLinkDto {
  @IsUUID() customerId!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) dueDate!: string;
}
class DeliveryLinkDto {
  @IsUUID() supplierId!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) dueDate!: string;
  @IsOptional() @IsUUID() accountId?: string;
}
class ExpenseLinkDto {
  @IsUUID() accountId!: string;
}
export class PetroDollarSelectionsDto {
  @IsOptional() @IsUUID() retailCustomerId?: string;
  @IsOptional() @IsUUID() cashAccountId?: string;
  @IsOptional() @IsUUID() mobileAccountId?: string;
  @IsOptional() @IsUUID() bankAccountId?: string;
  @IsUUID() receivableAccountId!: string;
  @IsUUID() revenueAccountId!: string;
  @IsUUID() payableAccountId!: string;
  @IsUUID() inventoryAccountId!: string;
  @IsUUID() costAccountId!: string;
  @IsUUID() expenseAccountId!: string;
  @IsUUID() varianceAccountId!: string;
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => CreditLinkDto)
  credits!: CreditLinkDto[];
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => DeliveryLinkDto)
  deliveries!: DeliveryLinkDto[];
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ExpenseLinkDto)
  expenses!: ExpenseLinkDto[];
}
export class PostPetroDollarDto {
  @IsUUID() requestId!: string;
  @IsInt() @Min(1) version!: number;
  @Matches(/^[a-f0-9]{64}$/) fingerprint!: string;
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => PetroDollarSelectionsDto)
  selections!: PetroDollarSelectionsDto;
}
export class ReversePetroDollarDto {
  @IsUUID() postingId!: string;
  @IsString() @MaxLength(500) reason!: string;
}
