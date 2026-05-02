import { IsString, IsOptional, IsBoolean, IsEnum } from 'class-validator';
import { HRDocumentCategory } from '@prisma/client';

export class CreateHrDocumentDto {
  @IsString() companyId!: string;
  @IsOptional() @IsString() employeeId?: string;
  @IsOptional() @IsString() entityType?: string;
  @IsOptional() @IsString() entityId?: string;
  @IsString() documentId!: string;
  @IsOptional() @IsEnum(HRDocumentCategory) documentCategory?: HRDocumentCategory;
  @IsOptional() @IsBoolean() isSensitive?: boolean;
}
