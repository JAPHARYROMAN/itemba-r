import { IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { SecurityRiskLevel, TwoFactorMethod } from '@prisma/client';

/**
 * Administrative profile fields only. TOTP secrets and backup-code hashes are
 * deliberately absent: those values are owned by the dedicated enrollment flow.
 */
export class CreateUserSecurityProfileDto {
  @IsNotEmpty()
  @IsString()
  userId!: string;

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
}
