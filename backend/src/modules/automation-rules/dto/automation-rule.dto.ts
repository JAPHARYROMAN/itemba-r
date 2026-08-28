import { AutomationTriggerType, AutomationType } from '@prisma/client';
import { PartialType } from '@nestjs/mapped-types';
import { IsEnum, IsObject, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateAutomationRuleDto {
  @IsString()
  automationRuleCode!: string;

  @IsOptional()
  @IsUUID()
  companyId?: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsEnum(AutomationType)
  automationType!: AutomationType;

  @IsEnum(AutomationTriggerType)
  triggerType!: AutomationTriggerType;

  @IsObject()
  triggerConfig!: Record<string, unknown>;

  @IsObject()
  actionConfig!: Record<string, unknown>;
}

export class UpdateAutomationRuleDto extends PartialType(CreateAutomationRuleDto) {}
