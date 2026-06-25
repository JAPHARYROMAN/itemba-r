import { IsBoolean, IsDateString, IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { DocumentCategory, DocumentOwnerType, DocumentStatus } from '@prisma/client';

export class QueryDocumentDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsUUID() companyId?: string;
  @IsOptional() @IsUUID() groupId?: string;
  @IsOptional() @IsEnum(DocumentCategory) category?: DocumentCategory;
  @IsOptional() @IsEnum(DocumentOwnerType) ownerType?: DocumentOwnerType;
  @IsOptional() @IsEnum(DocumentStatus) status?: DocumentStatus;
  @IsOptional() @Transform(({ value }) => value === 'true') @IsBoolean() isConfidential?: boolean;
  /** Filter docs expiring on or before this ISO date */
  @IsOptional() @IsDateString() expiringBefore?: string;
  /** Linked entity id (any) */
  @IsOptional() @IsString() ownerId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5000) limit?: number = 20;
}
