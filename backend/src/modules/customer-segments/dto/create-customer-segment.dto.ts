import { IsBoolean, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class CreateCustomerSegmentDto {
  @IsNotEmpty()
  @IsString()
  companyId!: string;

  // Optional: the server generates a globally-unique segmentCode when omitted
  // (the DB column is `@unique` with no default). A caller may still supply one
  // for backward-compat / migration; if it collides a clear 400 is returned.
  @IsOptional()
  @IsString()
  segmentCode?: string;

  @IsNotEmpty()
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsObject()
  criteria?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
