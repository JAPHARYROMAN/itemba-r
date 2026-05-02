import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { WcfAuditController } from './wcf-audit.controller';
import { WcfAuditService } from './wcf-audit.service';

@Module({
  imports: [PrismaModule],
  controllers: [WcfAuditController],
  providers: [WcfAuditService],
  exports: [WcfAuditService],
})
export class WcfAuditModule {}
