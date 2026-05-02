import { Module } from '@nestjs/common';
import { ReturnablePackagesService } from './returnable-packages.service';
import { ReturnablePackagesController } from './returnable-packages.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [ReturnablePackagesController],
  providers: [ReturnablePackagesService],
  exports: [ReturnablePackagesService],
})
export class ReturnablePackagesModule {}
