import { IsBoolean, IsDateString, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { DocumentCategory, DocumentOwnerType, DocumentStatus } from '@prisma/client';
import { Transform } from 'class-transformer';

export class CreateDocumentDto {
  @IsString() title!: string;
  @IsEnum(DocumentOwnerType) ownerType!: DocumentOwnerType;
  @IsString() ownerId!: string;
  @IsOptional() @IsEnum(DocumentCategory) category?: DocumentCategory;
  @IsOptional() @IsEnum(DocumentStatus) status?: DocumentStatus;
  @IsOptional() @IsString() documentCode?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional()
  @Transform(({ obj, key }) => {
    const raw: unknown = obj[key];
    return raw === true || raw === 'true' ? true : raw === false || raw === 'false' ? false : raw;
  })
  @IsBoolean()
  isConfidential?: boolean;
  @IsOptional() @IsDateString() expiryDate?: string;
  @IsOptional() @IsDateString() renewalDate?: string;
  @IsOptional() @IsString({ each: true }) tags?: string[];
  @IsOptional() @IsUUID() groupId?: string;
  @IsOptional() @IsUUID() companyId?: string;
  @IsOptional() @IsUUID() divisionId?: string;
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsUUID() bankAccountId?: string;
  @IsOptional() @IsUUID() loanId?: string;
  @IsOptional() @IsUUID() debtId?: string;
  @IsOptional() @IsUUID() contractId?: string;
  @IsOptional() @IsUUID() fixedAssetId?: string;
}
