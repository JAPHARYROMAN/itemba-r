import { IsBoolean, IsOptional, IsString, Matches } from 'class-validator';

export class CreatePermissionDto {
  @IsString()
  @Matches(/^[a-z0-9_.:-]+$/, {
    message: 'code must be lowercase dot-separated, e.g. companies.read',
  })
  code!: string;

  @IsString() description!: string;
  @IsString() module!: string;
  @IsString() action!: string;
  @IsOptional() @IsBoolean() isGroupControl?: boolean;
}
