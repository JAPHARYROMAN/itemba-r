import {
  ContactEntityType,
  CommunicationType,
  CommunicationDirection,
} from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

/**
 * Typed input for creating a communication log. Replaces the previous
 * `@Body() any`, so the global ValidationPipe (whitelist + forbidNonWhitelisted)
 * strips unexpected columns and enforces the real input shape. Note that
 * `communicationNumber`, `status` and `createdById` are deliberately absent —
 * they are generated/derived server-side.
 */
export class CreateCommunicationLogDto {
  @IsNotEmpty()
  @IsString()
  companyId!: string;

  @IsNotEmpty()
  @IsEnum(ContactEntityType)
  entityType!: ContactEntityType;

  @IsNotEmpty()
  @IsString()
  entityId!: string;

  @IsNotEmpty()
  @IsEnum(CommunicationType)
  communicationType!: CommunicationType;

  @IsOptional()
  @IsEnum(CommunicationDirection)
  direction?: CommunicationDirection;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsNotEmpty()
  @IsString()
  summary!: string;

  @IsOptional()
  @IsDateString()
  communicationDate?: string;

  @IsOptional()
  @IsBoolean()
  followUpRequired?: boolean;

  @IsOptional()
  @IsDateString()
  followUpDate?: string;

  @IsOptional()
  @IsString()
  assignedToId?: string;
}
