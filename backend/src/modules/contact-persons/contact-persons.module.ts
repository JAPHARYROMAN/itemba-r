import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CompanyScopeService } from '../../common/services';
import { ContactPersonsController } from './contact-persons.controller';
import { ContactPersonsService } from './contact-persons.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [ContactPersonsController],
  providers: [ContactPersonsService, CompanyScopeService],
  exports: [ContactPersonsService],
})
export class ContactPersonsModule {}