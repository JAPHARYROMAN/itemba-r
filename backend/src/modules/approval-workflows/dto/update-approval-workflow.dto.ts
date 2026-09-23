import {
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsInt,
  Min,
  Max,
  Matches,
  ValidateIf,
} from 'class-validator';
import { WorkflowScope, WorkflowTriggerAction } from '@prisma/client';

export class UpdateApprovalWorkflowDto {
  @ValidateIf((_object, value) => value !== undefined) @IsString() @Matches(/\S/) name?: string;
  @IsOptional() @IsString() description?: string | null;
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Matches(/\S/)
  entityType?: string;
  @ValidateIf((_object, value) => value !== undefined)
  @IsEnum(WorkflowScope)
  workflowScope?: WorkflowScope;
  @ValidateIf((_object, value) => value !== undefined)
  @IsEnum(WorkflowTriggerAction)
  triggerAction?: WorkflowTriggerAction;
  @ValidateIf((_object, value) => value !== undefined) @IsBoolean() isActive?: boolean;
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(-2147483648)
  @Max(2147483647)
  priority?: number;
}
