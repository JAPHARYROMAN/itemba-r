import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { FarmFieldsService } from './farm-fields.service';
import { FarmFieldsController } from './farm-fields.controller';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  providers: [FarmFieldsService],
  controllers: [FarmFieldsController],
  exports: [FarmFieldsService],
})
export class FarmFieldsModule {}
