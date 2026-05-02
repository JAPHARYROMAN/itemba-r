import { ApiProperty } from "@nestjs/swagger";
import { IsEmail } from "class-validator";

export class RequestPasswordResetDto {
  @ApiProperty({ description: "Email address of the account to reset" })
  @IsEmail()
  email!: string;
}
