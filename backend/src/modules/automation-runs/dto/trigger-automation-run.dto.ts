import { IsOptional, IsUUID } from 'class-validator';

export class TriggerAutomationRunDto {
  @IsUUID()
  ruleId!: string;

  @IsOptional()
  @IsUUID()
  companyId?: string;
}
