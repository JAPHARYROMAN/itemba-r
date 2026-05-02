import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { UserManualsController } from './user-manuals.controller';
import { UserManualsService } from './user-manuals.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [UserManualsController],
  providers: [UserManualsService],
  exports: [UserManualsService],
})
export class UserManualsModule {}
