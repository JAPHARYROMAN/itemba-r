import { ApiProperty } from "@nestjs/swagger";
import { IsString } from "class-validator";

export class VerifyPasswordDto {
  @ApiProperty({ description: "Current password for re-authentication" })
  @IsString()
  password!: string;
}
