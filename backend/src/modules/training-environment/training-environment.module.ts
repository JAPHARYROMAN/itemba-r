import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { TrainingEnvironmentController } from './training-environment.controller';
import { TrainingEnvironmentService } from './training-environment.service';
@Module({ imports: [PrismaModule, AuditLogsModule], controllers: [TrainingEnvironmentController], providers: [TrainingEnvironmentService], exports: [TrainingEnvironmentService] })
export class TrainingEnvironmentModule {}
