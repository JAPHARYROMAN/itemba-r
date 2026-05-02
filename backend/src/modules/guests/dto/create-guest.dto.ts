import { IsString, IsOptional, IsEnum } from 'class-validator';
import { GuestStatus } from '@prisma/client';

export class CreateGuestDto {
  @IsString() guestCode!: string;
  @IsString() companyId!: string;
  @IsString() fullName!: string;
  @IsEnum(GuestStatus) @IsOptional() status?: GuestStatus;
  @IsString() @IsOptional() customerId?: string;
  @IsString() @IsOptional() phone?: string;
  @IsString() @IsOptional() email?: string;
  @IsString() @IsOptional() nationality?: string;
  @IsString() @IsOptional() identificationType?: string;
  @IsString() @IsOptional() identificationNumber?: string;
  @IsString() @IsOptional() address?: string;
  @IsString() @IsOptional() notes?: string;
}
