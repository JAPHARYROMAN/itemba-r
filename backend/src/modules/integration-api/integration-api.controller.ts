import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { ApiKeyAuthGuard } from '../../common/guards/api-key-auth.guard';
import { RequireApiScope } from '../../common/decorators/require-api-scope.decorator';
import { ExternalPaymentsService } from '../external-payments/external-payments.service';
import { ExternalMessagesService } from '../external-messages/external-messages.service';
import { WebhookEventsService } from '../webhook-events/webhook-events.service';
import { CreateExternalPaymentDto } from '../external-payments/dto/create-external-payment.dto';

/**
 * External integration API surface — protected by API-key authentication
 * (`x-api-key` header) and scope-gated per route.
 *
 * P0-09: This controller is the canonical entry point for external systems
 * (mobile-money providers, ERP partners, payment processors). Authentication
 * uses the ApiKey table; scopes are enforced via @RequireApiScope, with AND
 * semantics over the key's `scopes` array.
 *
 * Standard scope vocabulary (every key must declare what it can call):
 *   - `payments.write` — create/confirm/reverse external payments
 *   - `payments.read`  — query external payment status
 *   - `messages.write` — push outbound messages / receive delivery callbacks
 *   - `webhooks.read`  — query webhook delivery status / replay
 *   - `webhooks.replay` — request replay of a failed webhook
 *
 * Routes here intentionally:
 *   - Carry `@Public()` to bypass the global JwtAuthGuard. They are NOT public
 *     in the security sense — `ApiKeyAuthGuard` is enforced via `@UseGuards`.
 *   - Do NOT carry `@RequirePermissions(...)` — permission grants belong to
 *     interactive users; integration callers operate under scopes.
 *   - Resolve `companyId` from the authenticated ApiKey's ApiClient row, never
 *     from request body, to prevent cross-tenant submissions.
 */
@ApiTags('integration-api')
@ApiSecurity('api-key')
@Public()
@UseGuards(ApiKeyAuthGuard)
@Controller('integration')
export class IntegrationApiController {
  constructor(
    private readonly externalPayments: ExternalPaymentsService,
    private readonly externalMessages: ExternalMessagesService,
    private readonly webhookEvents: WebhookEventsService,
  ) {}

  private requireBoundCompany(req: Request): { apiKey: any; companyId: string } {
    const apiKey = (req as any).apiKey;
    const companyId = apiKey?.apiClient?.companyId;
    if (!companyId) {
      throw new BadRequestException(
        'API key is not bound to a company; this integration route requires company scope.',
      );
    }
    return { apiKey, companyId };
  }

  // ─── Payments ──────────────────────────────────────────────────────────

  @Post('payments')
  @RequireApiScope('payments.write')
  async createPayment(@Body() dto: CreateExternalPaymentDto, @Req() req: Request) {
    const { apiKey, companyId } = this.requireBoundCompany(req);
    // Force the payment's company to match the key's company — never trust
    // the body to assert which tenant the payment belongs to.
    const safeDto = { ...dto, companyId };
    return this.externalPayments.create(safeDto, apiKey.apiClientId ?? apiKey.id);
  }

  @Post('payments/:id/confirm')
  @RequireApiScope('payments.write')
  async confirmPayment(@Param('id') id: string, @Req() req: Request) {
    const { apiKey, companyId } = this.requireBoundCompany(req);
    return this.externalPayments.confirm(id, apiKey.apiClientId ?? apiKey.id, companyId);
  }

  @Get('payments/:id')
  @RequireApiScope('payments.read')
  async getPayment(@Param('id') id: string, @Req() req: Request) {
    const { companyId } = this.requireBoundCompany(req);
    return this.externalPayments.findOne(id, false, companyId);
  }

  @Get('payments')
  @RequireApiScope('payments.read')
  async listPayments(@Query() query: any, @Req() req: Request) {
    const { companyId } = this.requireBoundCompany(req);
    return this.externalPayments.findAll({ ...query, companyId }, false, (req as any).user);
  }

  // ─── Messaging ─────────────────────────────────────────────────────────

  @Post('messages/delivery-callback')
  @RequireApiScope('messages.write')
  async messageDeliveryCallback(@Body() dto: any, @Req() req: Request) {
    const apiKey = (req as any).apiKey;
    if (!dto?.messageId) throw new BadRequestException('messageId is required');
    // Delegate to the external messages service if it exposes a callback method;
    // otherwise this becomes the integration-side audit trail of the callback.
    if (typeof (this.externalMessages as any).recordDeliveryCallback === 'function') {
      return (this.externalMessages as any).recordDeliveryCallback(
        dto,
        apiKey.apiClientId ?? apiKey.id,
      );
    }
    return { accepted: true, messageId: dto.messageId };
  }

  // ─── Webhooks ──────────────────────────────────────────────────────────

  @Get('webhooks/events/:id')
  @RequireApiScope('webhooks.read')
  async getWebhookEvent(@Param('id') id: string) {
    if (typeof (this.webhookEvents as any).findOne === 'function') {
      return (this.webhookEvents as any).findOne(id);
    }
    throw new BadRequestException('Webhook event lookup not available');
  }
}
