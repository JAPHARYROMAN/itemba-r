import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logs/audit-logs.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { EmploymentDisputesController } from './employment-disputes.controller';
import { EmploymentDisputesService } from './employment-disputes.service';

@Module({
  imports: [PrismaModule, AuditLogsModule, NotificationsModule],
  controllers: [EmploymentDisputesController],
  providers: [EmploymentDisputesService],
  exports: [EmploymentDisputesService],
})
export class EmploymentDisputesModule {}
