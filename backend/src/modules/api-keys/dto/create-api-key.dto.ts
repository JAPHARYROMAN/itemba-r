import { IsArray, IsDateString, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateApiKeyDto {
  @IsNotEmpty()
  @IsString()
  apiClientId!: string;

  @IsNotEmpty()
  @IsString()
  name!: string;

  @IsArray()
  scopes!: string[];

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
