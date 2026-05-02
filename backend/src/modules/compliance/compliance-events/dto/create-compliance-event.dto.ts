import { IsString, IsOptional, IsEnum, IsDateString } from 'class-validator';
import { ComplianceEventType } from '@prisma/client';

export class CreateComplianceEventDto {
  @IsString() eventNumber!: string;
  @IsString() companyId!: string;
  @IsOptional() @IsString() complianceObligationId?: string;
  @IsDateString() eventDate!: string;
  @IsOptional() @IsEnum(ComplianceEventType) eventType?: ComplianceEventType;
  @IsString() title!: string;
  @IsOptional() @IsString() description?: string;
  @IsString() createdById!: string;
  @IsOptional() @IsString() documentId?: string;
}
