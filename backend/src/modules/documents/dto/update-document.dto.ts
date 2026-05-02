import { IsBoolean, IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { DocumentCategory, DocumentStatus } from '@prisma/client';

export class UpdateDocumentDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsEnum(DocumentCategory) category?: DocumentCategory;
  @IsOptional() @IsEnum(DocumentStatus) status?: DocumentStatus;
  @IsOptional() @IsBoolean() isConfidential?: boolean;
  @IsOptional() @IsDateString() expiryDate?: string;
  @IsOptional() @IsDateString() renewalDate?: string;
  @IsOptional() @IsString({ each: true }) tags?: string[];
}
