import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CompanyScopeService, EncryptionService } from '../../common/services';
import { CapabilityInvoker } from './capability-invoker';
import { MsaidiziConversationsController } from './conversations.controller';
import { MsaidiziConversationsService } from './conversations.service';
import { ManifestProvider } from './manifest.provider';
import { AnthropicModelClient, ModelClient } from './model-client';
import { MsaidiziConfig } from './msaidizi.config';
import { MsaidiziController } from './msaidizi.controller';
import { MsaidiziService } from './msaidizi.service';
import { ProceduresController } from './procedures.controller';
import { ProceduresService } from './procedures.service';

/**
 * Msaidizi — the agent layer.
 *
 * Holds no business logic of its own. Every action it takes is an existing
 * endpoint, invoked over HTTP with the caller's own credential, so the module
 * adds a caller to the system rather than a new path through it.
 *
 * Inert unless MSAIDIZI_ENABLED=true and an API key is configured — with one
 * deliberate exception: conversation history stays readable when the module is
 * switched off, because a deployment that disables the agent should not also
 * make what it already did unreadable to the people who ran it.
 */
@Module({
  imports: [ConfigModule, PrismaModule, AuditLogsModule],
  controllers: [MsaidiziController, MsaidiziConversationsController, ProceduresController],
  providers: [
    MsaidiziConfig,
    ManifestProvider,
    CapabilityInvoker,
    MsaidiziService,
    MsaidiziConversationsService,
    ProceduresService,
    CompanyScopeService,
    // Conversation transcripts and resume state are AES-256-GCM ciphertext at
    // rest, following the integration-connections precedent. APP_ENCRYPTION_KEY
    // is already required in production and staging, so this adds no ops burden.
    EncryptionService,
    { provide: ModelClient, useClass: AnthropicModelClient },
  ],
  exports: [MsaidiziConfig],
})
export class MsaidiziModule {}
