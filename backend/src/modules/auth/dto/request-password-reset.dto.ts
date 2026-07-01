import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsEmail } from "class-validator";

/** Normalize email to a canonical form (trim + lowercase) so the reset lookup
 *  matches the stored/registered email regardless of the casing typed. */
const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim().toLowerCase() : value;

export class RequestPasswordResetDto {
  @ApiProperty({ description: "Email address of the account to reset" })
  @Transform(normalizeEmail)
  @IsEmail()
  email!: string;
}
