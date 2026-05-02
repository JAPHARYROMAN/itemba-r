import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { WebhookProcessingStatus, WebhookVerificationStatus } from '@prisma/client';

export class QueryWebhookEventDto {
  @IsOptional()
  @IsString()
  companyId?: string;

  @IsOptional()
  @IsString()
  providerId?: string;

  @IsOptional()
  @IsString()
  webhookEndpointId?: string;

  @IsOptional()
  @IsEnum(WebhookProcessingStatus)
  processingStatus?: WebhookProcessingStatus;

  @IsOptional()
  @IsEnum(WebhookVerificationStatus)
  verificationStatus?: WebhookVerificationStatus;

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
