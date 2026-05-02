import { IsString, IsOptional, IsEnum, IsDateString } from 'class-validator';
import { AuditEvidencePackType, AuditEvidencePackStatus } from '@prisma/client';

export class CreateAuditEvidencePackDto {
  @IsString() evidencePackNumber!: string;
  @IsString() companyId!: string;
  @IsString() title!: string;
  @IsOptional() @IsEnum(AuditEvidencePackType) packType?: AuditEvidencePackType;
  @IsOptional() @IsDateString() periodStart?: string;
  @IsOptional() @IsDateString() periodEnd?: string;
  @IsOptional() @IsEnum(AuditEvidencePackStatus) status?: AuditEvidencePackStatus;
  @IsString() preparedById!: string;
  @IsOptional() @IsString() notes?: string;
}
