import { IsOptional, IsString, IsNumberString, IsEnum } from 'class-validator';
import { CompanyStatus } from '@prisma/client';

export class QueryCompanyDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsEnum(CompanyStatus) status?: CompanyStatus;
  @IsOptional() @IsString() industryType?: string;
  @IsOptional() @IsNumberString() page?: string;
  @IsOptional() @IsNumberString() limit?: string;
}
