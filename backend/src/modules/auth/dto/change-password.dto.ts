import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

/**
 * Payload for the public POST /auth/change-password recovery endpoint. Consumes
 * the short-lived `passwordChange`-scoped tempToken that login()/2FA hand out
 * when User.mustChangePassword / UserSecurityProfile.forcePasswordChange /
 * passwordExpiresAt force a rotation. Without this endpoint a flagged account
 * (e.g. the seeded admin) can verify its password yet never obtain a session.
 */
export class ChangePasswordDto {
  @ApiProperty({
    description:
      'Short-lived password-change token issued by /auth/login (or /auth/2fa/challenge) ' +
      'when the account must rotate its password before a session can be granted.',
  })
  @IsString()
  tempToken!: string;

  @ApiProperty({ description: 'New password (minimum 8 characters)' })
  @IsString()
  @MinLength(8)
  newPassword!: string;
}
