import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { TrainingController } from './training.controller';
import { TrainingService } from './training.service';
@Module({ imports: [PrismaModule, AuditLogsModule], controllers: [TrainingController], providers: [TrainingService], exports: [TrainingService] })
export class TrainingModule {}
