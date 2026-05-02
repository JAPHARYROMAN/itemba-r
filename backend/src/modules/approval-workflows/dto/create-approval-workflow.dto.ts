import { IsString, IsOptional, IsEnum, IsBoolean, IsUUID, IsNumber } from 'class-validator';
import { WorkflowScope, WorkflowTriggerAction } from '@prisma/client';

export class CreateApprovalWorkflowDto {
  @IsOptional() @IsString() workflowCode?: string;
  @IsString() name!: string;
  @IsString() entityType!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsEnum(WorkflowScope) workflowScope?: WorkflowScope;
  @IsOptional() @IsEnum(WorkflowTriggerAction) triggerAction?: WorkflowTriggerAction;
  @IsOptional() @IsUUID() companyId?: string;
  @IsOptional() @IsUUID() divisionId?: string;
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsUUID() licensedBusinessUnitId?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsNumber() priority?: number;
}
