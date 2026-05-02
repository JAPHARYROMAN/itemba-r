import { IsString, IsOptional, IsEnum, IsUUID, IsDateString } from 'class-validator';
import { DelegationStatus } from '@prisma/client';

export class CreateApprovalDelegationDto {
  @IsUUID() delegatorUserId!: string;
  @IsUUID() delegateUserId!: string;
  @IsOptional() @IsUUID() companyId?: string;
  @IsOptional() @IsString() entityType?: string;
  @IsDateString() startDate!: string;
  @IsDateString() endDate!: string;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsEnum(DelegationStatus) status?: DelegationStatus;
}
