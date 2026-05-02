import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { TrainingEnrollmentsController } from './training-enrollments.controller';
import { TrainingEnrollmentsService } from './training-enrollments.service';
@Module({ imports: [PrismaModule, AuditLogsModule], controllers: [TrainingEnrollmentsController], providers: [TrainingEnrollmentsService], exports: [TrainingEnrollmentsService] })
export class TrainingEnrollmentsModule {}
