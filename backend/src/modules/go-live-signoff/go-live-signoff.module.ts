import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { GoLiveSignoffController } from './go-live-signoff.controller';
import { GoLiveSignoffService } from './go-live-signoff.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [GoLiveSignoffController],
  providers: [GoLiveSignoffService],
  exports: [GoLiveSignoffService],
})
export class GoLiveSignoffModule {}
