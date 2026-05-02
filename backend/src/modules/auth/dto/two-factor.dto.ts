import { ApiProperty } from "@nestjs/swagger";
import { IsString } from "class-validator";

export class TwoFactorVerifyDto {
  @ApiProperty({ description: "6-digit TOTP code" })
  @IsString()
  code!: string;
}

export class TwoFactorChallengeDto {
  @ApiProperty({ description: "Temporary 2FA challenge token from login response" })
  @IsString()
  tempToken!: string;

  @ApiProperty({ description: "6-digit TOTP code or 8-character backup code" })
  @IsString()
  code!: string;
}

export class DisableTwoFactorDto {
  @ApiProperty({ description: "Current TOTP code to confirm 2FA disable" })
  @IsString()
  code!: string;
}
