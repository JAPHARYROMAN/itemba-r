import { IsString, IsOptional, IsEnum, IsNumber } from 'class-validator';
import { SubcontractorStatus } from '@prisma/client';

export class CreateSubcontractorDto {
  @IsString() subcontractorCode!: string;
  @IsString() companyId!: string;
  @IsString() divisionId!: string;
  @IsString() @IsOptional() projectId?: string;
  @IsString() @IsOptional() supplierId?: string;
  @IsString() name!: string;
  @IsString() @IsOptional() serviceDescription?: string;
  @IsNumber() @IsOptional() contractValue?: number;
  @IsString() @IsOptional() currency?: string;
  @IsEnum(SubcontractorStatus) @IsOptional() status?: SubcontractorStatus;
  @IsString() @IsOptional() notes?: string;
}
