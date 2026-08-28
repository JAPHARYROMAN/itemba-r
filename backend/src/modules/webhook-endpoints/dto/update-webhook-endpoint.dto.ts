import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateWebhookEndpointDto } from './create-webhook-endpoint.dto';

export class UpdateWebhookEndpointDto extends PartialType(
  OmitType(CreateWebhookEndpointDto, ['webhookCode'] as const),
) {}
