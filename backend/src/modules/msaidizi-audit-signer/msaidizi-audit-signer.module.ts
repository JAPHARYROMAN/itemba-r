import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { MsaidiziAuditSignerConfig } from './msaidizi-audit-signer.config';
import { MsaidiziAuditSignerController } from './msaidizi-audit-signer.controller';
import { MsaidiziAuditSignerGuard } from './msaidizi-audit-signer.guard';
import { MsaidiziAuditSignerService } from './msaidizi-audit-signer.service';

@Module({
  imports: [ConfigModule, PrismaModule],
  controllers: [MsaidiziAuditSignerController],
  providers: [MsaidiziAuditSignerConfig, MsaidiziAuditSignerGuard, MsaidiziAuditSignerService],
})
export class MsaidiziAuditSignerModule {}
