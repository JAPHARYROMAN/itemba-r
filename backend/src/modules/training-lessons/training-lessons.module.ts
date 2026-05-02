import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { TrainingLessonsController } from './training-lessons.controller';
import { TrainingLessonsService } from './training-lessons.service';
@Module({ imports: [PrismaModule, AuditLogsModule], controllers: [TrainingLessonsController], providers: [TrainingLessonsService], exports: [TrainingLessonsService] })
export class TrainingLessonsModule {}
