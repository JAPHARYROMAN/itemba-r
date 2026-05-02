import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import {
  ExternalMessageChannel,
  MessageTemplateStatus,
  MessageTemplateType,
} from '@prisma/client';

export class QueryMessageTemplateDto {
  @IsOptional()
  @IsString()
  companyId?: string;

  @IsOptional()
  @IsEnum(ExternalMessageChannel)
  channel?: ExternalMessageChannel;

  @IsOptional()
  @IsEnum(MessageTemplateType)
  templateType?: MessageTemplateType;

  @IsOptional()
  @IsEnum(MessageTemplateStatus)
  status?: MessageTemplateStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;
}
