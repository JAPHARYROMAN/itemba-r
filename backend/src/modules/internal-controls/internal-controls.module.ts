import { Module } from '@nestjs/common';
import { InternalControlsController } from './internal-controls.controller';
import { InternalControlsService } from './internal-controls.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [InternalControlsController],
  providers: [InternalControlsService],
  exports: [InternalControlsService],
})
export class InternalControlsModule {}
