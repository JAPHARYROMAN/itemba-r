import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { MsaidiziEvaluatorKeyRegistry } from '../msaidizi-updates/msaidizi-evaluator-key-registry.service';
import { MsaidiziArtifactsController } from './msaidizi-artifacts.controller';
import { MsaidiziArtifactsService } from './msaidizi-artifacts.service';

@Module({
  imports: [ConfigModule, PrismaModule, AuditLogsModule],
  controllers: [MsaidiziArtifactsController],
  providers: [MsaidiziArtifactsService, MsaidiziEvaluatorKeyRegistry],
  exports: [MsaidiziArtifactsService, MsaidiziEvaluatorKeyRegistry],
})
export class MsaidiziArtifactsModule {}
