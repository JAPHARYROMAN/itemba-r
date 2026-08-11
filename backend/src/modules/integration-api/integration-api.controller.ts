import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  Body,
} from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { ExternalMessageStatus } from '@prisma/client';
import { Public } from '../../common/decorators/public.decorator';
import { ApiKeyAuthGuard } from '../../common/guards/api-key-auth.guard';
import { RequireApiScope } from '../../common/decorators/require-api-scope.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { ExternalPaymentsService } from '../external-payments/external-payments.service';
import { ExternalMessagesService } from '../external-messages/external-messages.service';
import { CreateExternalPaymentDto } from '../external-payments/dto/create-external-payment.dto';
import { MessageDeliveryCallbackDto } from './dto/message-delivery-callback.dto';
import { mapProviderStatus, isDeliveredStatus } from './message-delivery-status';

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
    private readonly prisma: PrismaService,
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
    return this.externalPayments.createForCompany(dto, apiKey.apiClientId ?? apiKey.id, companyId);
  }

  @Post('payments/:id/confirm')
  @RequireApiScope('payments.write')
  async confirmPayment(@Param('id') id: string, @Req() req: Request) {
    const { apiKey, companyId } = this.requireBoundCompany(req);
    return this.externalPayments.confirmForCompany(id, apiKey.apiClientId ?? apiKey.id, companyId);
  }

  @Get('payments/:id')
  @RequireApiScope('payments.read')
  async getPayment(@Param('id') id: string, @Req() req: Request) {
    const { companyId } = this.requireBoundCompany(req);
    return this.externalPayments.findOneForCompany(id, false, companyId);
  }

  @Get('payments')
  @RequireApiScope('payments.read')
  async listPayments(@Query() query: any, @Req() req: Request) {
    const { companyId } = this.requireBoundCompany(req);
    return this.externalPayments.findAll({ ...query, companyId }, false, (req as any).user);
  }

  // ─── Messaging ─────────────────────────────────────────────────────────

  /**
   * Provider delivery-status callback.
   *
   * ITMB-AUDIT (missing-logic): this route previously returned
   * `{ accepted: true }` unconditionally — the provider's delivery status was
   * discarded and the ExternalMessage row was never marked delivered/failed, so
   * delivery reporting was permanently stuck at the send-time status. It now:
   *   - resolves the message within the API key's bound company (matched by id,
   *     messageNumber, or externalReference) — cross-tenant isolation,
   *   - maps the provider status string to an ExternalMessageStatus,
   *   - persists status + deliveredAt/errorMessage/externalReference,
   *   - is idempotent: replaying the same terminal callback is a no-op update.
   *
   * A message that cannot be resolved for this company yields 404 (fail-closed)
   * so the provider does not treat the callback as applied when it was not.
   */
  @Post('messages/delivery-callback')
  @RequireApiScope('messages.write')
  async messageDeliveryCallback(@Body() dto: MessageDeliveryCallbackDto, @Req() req: Request) {
    const { companyId } = this.requireBoundCompany(req);
    if (!dto?.messageId) throw new BadRequestException('messageId is required');

    const mappedStatus = mapProviderStatus(dto.status);

    // Resolve strictly within the key's company so a provider bound to tenant A
    // cannot mutate tenant B's message by guessing an id.
    const message = await this.prisma.externalMessage.findFirst({
      where: {
        companyId,
        OR: [
          { id: dto.messageId },
          { messageNumber: dto.messageId },
          { externalReference: dto.messageId },
        ],
      },
      select: { id: true, status: true },
    });
    if (!message) throw new NotFoundException('External message not found');

    // Unknown / non-terminal provider status: acknowledge without corrupting the
    // stored status. We still record the provider reference if one was supplied.
    if (!mappedStatus) {
      if (dto.providerReference) {
        await this.prisma.externalMessage.update({
          where: { id: message.id },
          data: { externalReference: dto.providerReference },
        });
      }
      return {
        accepted: true,
        applied: false,
        messageId: message.id,
        status: message.status,
        reason: `Unrecognised provider status "${dto.status}"; message status unchanged.`,
      };
    }

    const eventAt = this.parseCallbackTimestamp(dto.timestamp);

    const data: {
      status: ExternalMessageStatus;
      deliveredAt?: Date;
      errorMessage?: string | null;
      externalReference?: string;
    } = { status: mappedStatus };

    if (isDeliveredStatus(mappedStatus)) {
      data.deliveredAt = eventAt;
      // Clear any stale error from an earlier failed attempt.
      data.errorMessage = null;
    } else if (mappedStatus === ExternalMessageStatus.FAILED) {
      data.errorMessage = dto.failureReason ?? 'Delivery failed (provider callback)';
    }
    if (dto.providerReference) data.externalReference = dto.providerReference;

    const updated = await this.prisma.externalMessage.update({
      where: { id: message.id },
      data,
      select: {
        id: true,
        messageNumber: true,
        status: true,
        deliveredAt: true,
        errorMessage: true,
        externalReference: true,
        updatedAt: true,
      },
    });

    return { accepted: true, applied: true, message: updated };
  }

  /** Parse a provider-supplied ISO timestamp, defaulting to now() when absent/invalid. */
  private parseCallbackTimestamp(raw?: string): Date {
    if (!raw) return new Date();
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }

  // ─── Webhooks ──────────────────────────────────────────────────────────

  @Get('webhooks/events/:id')
  @RequireApiScope('webhooks.read')
  async getWebhookEvent(@Param('id') id: string, @Req() req: Request) {
    // ITMB-AUDIT: previously delegated to WebhookEventsService.findOne(id) with a
    // single argument. That method requires (id, includeSensitive, user); calling
    // it with only `id` left `user` undefined, so its internal
    // companyScope.assertCanAccessCompany(undefined, ...) always threw — the route
    // was effectively dead. The integration surface authenticates with an API key
    // (no AuthUser), so scope the lookup by the key's bound company directly,
    // mirroring ExternalPaymentsService.findOneForCompany. Sensitive fields
    // (payload/headers) are never exposed on this read route.
    const { companyId } = this.requireBoundCompany(req);
    const record = await this.prisma.webhookEvent.findFirst({
      where: { id, companyId },
      select: {
        id: true,
        webhookEventNumber: true,
        webhookEndpointId: true,
        providerId: true,
        connectionId: true,
        companyId: true,
        eventName: true,
        externalEventId: true,
        verificationStatus: true,
        processingStatus: true,
        linkedEntityType: true,
        linkedEntityId: true,
        errorMessage: true,
        receivedAt: true,
        processedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!record) throw new NotFoundException('Webhook event not found');
    return record;
  }
}
