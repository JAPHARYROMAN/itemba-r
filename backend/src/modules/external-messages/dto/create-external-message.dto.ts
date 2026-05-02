import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import {
  ExternalMessageChannel,
  ExternalMessageRecipientType,
} from '@prisma/client';

export class CreateExternalMessageDto {
  @IsOptional()
  @IsString()
  companyId?: string;

  @IsOptional()
  @IsString()
  providerId?: string;

  @IsOptional()
  @IsString()
  connectionId?: string;

  @IsNotEmpty()
  @IsString()
  recipient!: string;

  @IsOptional()
  @IsEnum(ExternalMessageRecipientType)
  recipientType?: ExternalMessageRecipientType;

  @IsEnum(ExternalMessageChannel)
  channel!: ExternalMessageChannel;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsNotEmpty()
  @IsString()
  body!: string;

  @IsOptional()
  @IsString()
  templateId?: string;
}
