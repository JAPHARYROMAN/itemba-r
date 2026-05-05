import { IsOptional, IsString, IsUUID, IsEnum, IsEmail } from 'class-validator';
import { CompanyStatus } from '@prisma/client';

export class CreateCompanyDto {
  @IsUUID() groupId!: string;
  @IsString() name!: string;
  @IsString() code!: string;
  @IsOptional() @IsString() industryType?: string;
  @IsOptional() @IsEnum(CompanyStatus) status?: CompanyStatus;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() website?: string;
  @IsOptional() @IsString() logoUrl?: string;
}
