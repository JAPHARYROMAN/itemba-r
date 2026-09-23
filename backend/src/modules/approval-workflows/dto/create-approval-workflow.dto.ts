import {
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsUUID,
  IsInt,
  Min,
  Max,
  Matches,
  ValidateIf,
} from 'class-validator';
import { WorkflowScope, WorkflowTriggerAction } from '@prisma/client';

export class CreateApprovalWorkflowDto {
  @IsOptional() @IsString() workflowCode?: string;
  @IsString() @Matches(/\S/) name!: string;
  @IsString() @Matches(/\S/) entityType!: string;
  @IsOptional() @IsString() description?: string;
  @ValidateIf((_object, value) => value !== undefined)
  @IsEnum(WorkflowScope)
  workflowScope?: WorkflowScope;
  @ValidateIf((_object, value) => value !== undefined)
  @IsEnum(WorkflowTriggerAction)
  triggerAction?: WorkflowTriggerAction;
  @IsOptional() @IsUUID() companyId?: string;
  @IsOptional() @IsUUID() divisionId?: string;
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsUUID() licensedBusinessUnitId?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() @Min(-2147483648) @Max(2147483647) priority?: number;
}
