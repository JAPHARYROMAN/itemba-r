import { IsArray, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { WebhookEndpointStatus } from '@prisma/client';

export class CreateWebhookEndpointDto {
  @IsNotEmpty()
  @IsString()
  webhookCode!: string;

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
  name!: string;

  @IsNotEmpty()
  @IsString()
  endpointPath!: string;

  @IsOptional()
  @IsEnum(WebhookEndpointStatus)
  status?: WebhookEndpointStatus;

  @IsOptional()
  @IsArray()
  allowedEvents?: string[];
}
