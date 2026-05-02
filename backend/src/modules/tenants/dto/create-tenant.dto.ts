import { IsString, IsOptional, IsEnum, IsEmail } from 'class-validator';
import { TenantType, TenantStatus } from '@prisma/client';

export class CreateTenantDto {
  @IsString() tenantCode!: string;
  @IsString() companyId!: string;
  @IsString() name!: string;
  @IsEnum(TenantType) tenantType!: TenantType;
  @IsEnum(TenantStatus) @IsOptional() status?: TenantStatus;
  @IsString() @IsOptional() legalName?: string;
  @IsString() @IsOptional() tin?: string;
  @IsString() @IsOptional() phone?: string;
  @IsEmail() @IsOptional() email?: string;
  @IsString() @IsOptional() address?: string;
  @IsString() @IsOptional() contactPerson?: string;
  @IsString() @IsOptional() identificationType?: string;
  @IsString() @IsOptional() identificationNumber?: string;
  @IsString() @IsOptional() customerId?: string;
  @IsString() @IsOptional() notes?: string;
}
