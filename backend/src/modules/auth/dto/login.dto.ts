import { Transform } from 'class-transformer';
import { IsEmail, IsString, MinLength } from 'class-validator';

/** Normalize email to a canonical form (trim + lowercase) so login lookups and
 *  the in-memory lockout key use the same casing as stored/registered emails. */
const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class LoginDto {
  @Transform(normalizeEmail)
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;
}
