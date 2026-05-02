import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { TrainingCoursesController } from './training-courses.controller';
import { TrainingCoursesService } from './training-courses.service';
@Module({ imports: [PrismaModule, AuditLogsModule], controllers: [TrainingCoursesController], providers: [TrainingCoursesService], exports: [TrainingCoursesService] })
export class TrainingCoursesModule {}
