import { IsString, IsOptional, IsEnum, IsUUID, IsDateString, ValidateIf } from 'class-validator';
import { DelegationStatus } from '@prisma/client';

export class CreateApprovalDelegationDto {
  @IsUUID() delegatorUserId!: string;
  @IsUUID() delegateUserId!: string;
  @IsOptional() @IsUUID() companyId?: string | null;
  @IsOptional() @IsString() entityType?: string | null;
  @IsDateString() startDate!: string;
  @IsDateString() endDate!: string;
  @IsOptional() @IsString() reason?: string | null;
  @ValidateIf((_, value) => value !== undefined)
  @IsEnum(DelegationStatus)
  status?: DelegationStatus;
}

export class UpdateApprovalDelegationDto {
  @ValidateIf((_, value) => value !== undefined) @IsUUID() delegatorUserId?: string;
  @ValidateIf((_, value) => value !== undefined) @IsUUID() delegateUserId?: string;
  @IsOptional() @IsUUID() companyId?: string | null;
  @IsOptional() @IsString() entityType?: string | null;
  @ValidateIf((_, value) => value !== undefined) @IsDateString() startDate?: string;
  @ValidateIf((_, value) => value !== undefined) @IsDateString() endDate?: string;
  @IsOptional() @IsString() reason?: string | null;
  @ValidateIf((_, value) => value !== undefined)
  @IsEnum(DelegationStatus)
  status?: DelegationStatus;
}
