import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CompanyScopeService } from '../../common/services';
import { CapabilityInvoker } from './capability-invoker';
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
 * Inert unless MSAIDIZI_ENABLED=true and an API key is configured.
 */
@Module({
  imports: [ConfigModule, PrismaModule, AuditLogsModule],
  controllers: [MsaidiziController, ProceduresController],
  providers: [
    MsaidiziConfig,
    ManifestProvider,
    CapabilityInvoker,
    MsaidiziService,
    ProceduresService,
    CompanyScopeService,
    { provide: ModelClient, useClass: AnthropicModelClient },
  ],
  exports: [MsaidiziConfig],
})
export class MsaidiziModule {}
