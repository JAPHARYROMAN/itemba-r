import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { ContactEntityType } from '@prisma/client';

export class CreateContactPersonDto {
  @IsNotEmpty()
  @IsString()
  companyId!: string;

  @IsEnum(ContactEntityType)
  entityType!: ContactEntityType;

  @IsNotEmpty()
  @IsString()
  entityId!: string;

  @IsNotEmpty()
  @IsString()
  fullName!: string;

  @IsOptional()
  @IsString()
  position?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @IsOptional()
  @IsString()
  notes?: string;
}
