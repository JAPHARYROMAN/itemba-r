import {
  DebitCredit,
  PostingAmountSource,
  PostingSourceType,
  PostingTriggerAction,
} from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class CreatePostingRuleDto {
  @IsString()
  ruleCode!: string;

  @IsOptional()
  @IsUUID('all')
  companyId?: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(PostingSourceType)
  sourceType!: PostingSourceType;

  @IsEnum(PostingTriggerAction)
  triggerAction!: PostingTriggerAction;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;
}

export class UpdatePostingRuleDto {
  @IsOptional()
  @IsString()
  ruleCode?: string;

  @IsOptional()
  @IsUUID('all')
  companyId?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(PostingSourceType)
  sourceType?: PostingSourceType;

  @IsOptional()
  @IsEnum(PostingTriggerAction)
  triggerAction?: PostingTriggerAction;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;
}

export class CreatePostingRuleLineDto {
  @IsInt()
  @Min(0)
  lineOrder!: number;

  @IsEnum(DebitCredit)
  debitCredit!: DebitCredit;

  @IsUUID('all')
  accountId!: string;

  @IsEnum(PostingAmountSource)
  amountSource!: PostingAmountSource;

  @IsOptional()
  @IsObject()
  formula?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  descriptionTemplate?: string;
}
