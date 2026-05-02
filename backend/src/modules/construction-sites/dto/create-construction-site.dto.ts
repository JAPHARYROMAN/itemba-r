import { IsString, IsOptional, IsEnum } from 'class-validator';
import { ConstructionSiteStatus } from '@prisma/client';

export class CreateConstructionSiteDto {
  @IsString() siteCode!: string;
  @IsString() companyId!: string;
  @IsString() divisionId!: string;
  @IsString() projectId!: string;
  @IsString() siteName!: string;
  @IsString() @IsOptional() location?: string;
  @IsString() @IsOptional() siteManagerId?: string;
  @IsEnum(ConstructionSiteStatus) @IsOptional() status?: ConstructionSiteStatus;
  @IsString() @IsOptional() notes?: string;
}
