import { IsString, IsOptional, IsEnum, IsBoolean, IsUUID, IsNumber } from 'class-validator';
import { ApproverType } from '@prisma/client';

export class CreateApprovalStepDto {
  @IsUUID() workflowId!: string;
  @IsString() stepName!: string;
  @IsNumber() stepOrder!: number;
  @IsEnum(ApproverType) approverType!: ApproverType;
  @IsOptional() @IsUUID() approverUserId?: string;
  @IsOptional() @IsUUID() approverRoleId?: string;
  @IsOptional() @IsString() approverPermission?: string;
  @IsOptional() @IsNumber() minRequiredApprovals?: number;
  @IsOptional() @IsBoolean() allowSelfApproval?: boolean;
  @IsOptional() @IsBoolean() isFinalStep?: boolean;
  @IsOptional() @IsNumber() escalationHours?: number;
  @IsOptional() @IsUUID() escalationUserId?: string;
  @IsOptional() @IsUUID() escalationRoleId?: string;
}
