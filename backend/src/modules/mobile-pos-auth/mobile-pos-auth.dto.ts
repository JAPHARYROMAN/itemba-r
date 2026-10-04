import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class MobilePosRegistrationDto {
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsIn(['CASHIER', 'STOCKIST', 'ADMIN']) role!: 'CASHIER' | 'STOCKIST' | 'ADMIN';
}
export class MobilePosSetupDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]{32}$/) claimToken!: string;
  @IsString() @Matches(/^[a-f0-9]{64}$/) deviceSecret!: string;
  @IsString() @Matches(/^\d{6}$/) pin!: string;
}
export class MobilePosLoginDto {
  @IsUUID() enrollmentId!: string;
  @IsString() @Matches(/^[a-f0-9]{64}$/) deviceSecret!: string;
  @IsString() @Matches(/^\d{6}$/) pin!: string;
}
export class MobilePosRefreshDto {
  @IsString() @MaxLength(2048) refreshToken!: string;
  @IsString() @Matches(/^[a-f0-9]{64}$/) deviceSecret!: string;
}
export class MobilePosResetDto extends MobilePosLoginDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]{32}$/) resetToken!: string;
}
export class MobilePosPaymentMappingDto {
  @IsIn(['CASH', 'MOBILE_MONEY', 'BANK_TRANSFER']) paymentMethod!:
    | 'CASH'
    | 'MOBILE_MONEY'
    | 'BANK_TRANSFER';
  @IsUUID() cashAccountId!: string;
  @IsOptional() @IsString() @MaxLength(80) label?: string;
}
export class MobilePosBranchSetupDto {
  @IsUUID() companyId!: string;
  @IsUUID() divisionId!: string;
  @IsUUID() branchId!: string;
  @IsUUID() generalCustomerId!: string;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MobilePosPaymentMappingDto)
  paymentMappings!: MobilePosPaymentMappingDto[];
  @IsOptional() @IsBoolean() approvalRequired?: boolean;
  @IsOptional() @IsBoolean() enabled?: boolean;
}
export class MobilePosInviteDto {
  @IsUUID() branchSetupId!: string;
}
export class MobilePosApproveDto {
  @IsIn(['CASHIER', 'STOCKIST']) role!: 'CASHIER' | 'STOCKIST';
}
export class MobilePosReasonDto {
  @IsString() @MinLength(2) @MaxLength(500) reason!: string;
}
export class MobilePosAdminLinkDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]{32}$/) claimToken!: string;
}
