import { IsString, IsOptional, IsEnum } from 'class-validator';
import { AuditEvidencePackItemType } from '@prisma/client';

export class CreateAuditEvidencePackItemDto {
  @IsOptional() @IsString() evidencePackId?: string;
  @IsOptional() @IsEnum(AuditEvidencePackItemType) itemType?: AuditEvidencePackItemType;
  @IsOptional() @IsString() linkedEntityType?: string;
  @IsOptional() @IsString() linkedEntityId?: string;
  @IsOptional() @IsString() documentId?: string;
  @IsString() title!: string;
  @IsOptional() @IsString() description?: string;
}
