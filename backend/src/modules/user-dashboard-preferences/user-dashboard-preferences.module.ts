import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { UserDashboardPreferencesController } from './user-dashboard-preferences.controller';
import { UserDashboardPreferencesService } from './user-dashboard-preferences.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [UserDashboardPreferencesController],
  providers: [UserDashboardPreferencesService],
  exports: [UserDashboardPreferencesService],
})
export class UserDashboardPreferencesModule {}
