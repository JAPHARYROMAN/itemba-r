import { IsString, IsOptional, IsEnum, IsUUID } from 'class-validator';
import { ApprovalRequestActionType } from '@prisma/client';

export class CreateApprovalRequestDto {
  @IsOptional() @IsUUID() workflowId?: string;
  @IsOptional() @IsUUID() companyId?: string;
  @IsString() entityType!: string;
  @IsString() entityId!: string;
  @IsString() requestTitle!: string;
  @IsOptional() @IsString() requestSummary?: string;
  @IsOptional() @IsEnum(ApprovalRequestActionType) actionType?: ApprovalRequestActionType;
  @IsOptional() @IsString() notes?: string;
}
