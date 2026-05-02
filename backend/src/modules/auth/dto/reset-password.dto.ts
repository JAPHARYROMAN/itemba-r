import { ApiProperty } from "@nestjs/swagger";
import { IsString, MinLength } from "class-validator";

export class ResetPasswordDto {
  @ApiProperty({ description: "Password reset token received via email" })
  @IsString()
  token!: string;

  @ApiProperty({ description: "New password (minimum 8 characters)" })
  @IsString()
  @MinLength(8)
  newPassword!: string;
}
