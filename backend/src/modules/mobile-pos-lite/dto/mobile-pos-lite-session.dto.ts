import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ActivateMobilePosTerminalDto {
  @IsString()
  @MinLength(6)
  @MaxLength(64)
  terminalCode!: string;

  @IsString()
  @MinLength(32)
  @MaxLength(256)
  activationCode!: string;

  @IsString()
  @MinLength(32)
  @MaxLength(256)
  deviceSecret!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceName?: string;
}

export class QueryMobilePosLiteCatalogDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}
