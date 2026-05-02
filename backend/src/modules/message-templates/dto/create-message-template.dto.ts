import {
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';
import {
  ExternalMessageChannel,
  MessageTemplateStatus,
  MessageTemplateType,
} from '@prisma/client';

export class CreateMessageTemplateDto {
  @IsNotEmpty()
  @IsString()
  templateCode!: string;

  @IsOptional()
  @IsString()
  companyId?: string;

  @IsNotEmpty()
  @IsString()
  name!: string;

  @IsEnum(ExternalMessageChannel)
  channel!: ExternalMessageChannel;

  @IsOptional()
  @IsEnum(MessageTemplateType)
  templateType?: MessageTemplateType;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsNotEmpty()
  @IsString()
  body!: string;

  @IsOptional()
  @IsObject()
  variables?: Record<string, any>;

  @IsOptional()
  @IsEnum(MessageTemplateStatus)
  status?: MessageTemplateStatus;
}
