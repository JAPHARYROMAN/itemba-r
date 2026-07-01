import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
} from 'class-validator';
import { ContactEntityType } from '@prisma/client';

export class UpdateContactPersonDto {
  // companyId is accepted so the service can reject attempts to move a record
  // to another company; it is treated as immutable on update.
  @IsOptional()
  @IsString()
  companyId?: string;

  @IsOptional()
  @IsEnum(ContactEntityType)
  entityType?: ContactEntityType;

  @IsOptional()
  @IsString()
  entityId?: string;

  @IsOptional()
  @IsString()
  fullName?: string;

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
