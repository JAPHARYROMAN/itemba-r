import { Transform } from 'class-transformer';
import { IsEmail, IsString, MinLength } from 'class-validator';

/** Normalize email to a canonical form (trim + lowercase) so the stored email
 *  matches what login() looks up (login lookup + lockout both use lowercase). */
const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class RegisterDto {
  @Transform(normalizeEmail)
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsString()
  fullName!: string;
}
