import { CommunicationType, CommunicationDirection, CommunicationStatus } from '@prisma/client';
import { IsBoolean, IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';

/**
 * Typed input for updating a communication log. `companyId`, `entityType` and
 * `entityId` are intentionally omitted so a record cannot be moved across
 * companies/entities via update (mass-assignment guard). `communicationNumber`
 * and `createdById` are immutable and never accepted from the client.
 */
export class UpdateCommunicationLogDto {
  @IsOptional()
  @IsEnum(CommunicationType)
  communicationType?: CommunicationType;

  @IsOptional()
  @IsEnum(CommunicationDirection)
  direction?: CommunicationDirection;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsString()
  summary?: string;

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

  @IsOptional()
  @IsEnum(CommunicationStatus)
  status?: CommunicationStatus;
}
