import {
  DocumentTemplateFormat,
  DocumentTemplateStatus,
  DocumentTemplateType,
} from '@prisma/client';
import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsEnum, IsObject, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateDocumentTemplateDto {
  @IsString()
  templateCode!: string;

  @IsOptional()
  @IsUUID()
  companyId?: string;

  @IsString()
  name!: string;

  @IsEnum(DocumentTemplateType)
  templateType!: DocumentTemplateType;

  @IsOptional()
  @IsEnum(DocumentTemplateFormat)
  format?: DocumentTemplateFormat;

  @IsString()
  content!: string;

  @IsOptional()
  @IsObject()
  variables?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  headerConfig?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  footerConfig?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  pageConfig?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsEnum(DocumentTemplateStatus)
  status?: DocumentTemplateStatus;
}

export class UpdateDocumentTemplateDto extends PartialType(CreateDocumentTemplateDto) {}
