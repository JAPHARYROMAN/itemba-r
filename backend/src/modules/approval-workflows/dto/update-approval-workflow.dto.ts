import { IsString, IsOptional, IsEnum, IsBoolean, IsNumber } from 'class-validator';
import { WorkflowScope, WorkflowTriggerAction } from '@prisma/client';

export class UpdateApprovalWorkflowDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() entityType?: string;
  @IsOptional() @IsEnum(WorkflowScope) workflowScope?: WorkflowScope;
  @IsOptional() @IsEnum(WorkflowTriggerAction) triggerAction?: WorkflowTriggerAction;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsNumber() priority?: number;
}
