import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { GuidedWalkthroughsController } from './guided-walkthroughs.controller';
import { GuidedWalkthroughsService } from './guided-walkthroughs.service';
@Module({ imports: [PrismaModule, AuditLogsModule], controllers: [GuidedWalkthroughsController], providers: [GuidedWalkthroughsService], exports: [GuidedWalkthroughsService] })
export class GuidedWalkthroughsModule {}
