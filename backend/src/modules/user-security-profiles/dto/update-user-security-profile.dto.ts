import { IsBoolean, IsDateString, IsEnum, IsOptional } from 'class-validator';
import { SecurityRiskLevel, TwoFactorMethod } from '@prisma/client';

/** Secret-bearing fields are intentionally not part of the administrative update surface. */
export class UpdateUserSecurityProfileDto {
  @IsOptional()
  @IsBoolean()
  twoFactorEnabled?: boolean;

  @IsOptional()
  @IsEnum(TwoFactorMethod)
  twoFactorMethod?: TwoFactorMethod;

  @IsOptional()
  @IsBoolean()
  forcePasswordChange?: boolean;

  @IsOptional()
  @IsBoolean()
  forceTwoFactorSetup?: boolean;

  @IsOptional()
  @IsEnum(SecurityRiskLevel)
  securityRiskLevel?: SecurityRiskLevel;

  @IsOptional()
  @IsDateString()
  lockedUntil?: string | null;

  @IsOptional()
  @IsDateString()
  passwordExpiresAt?: string | null;
}
