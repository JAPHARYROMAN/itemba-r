import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { RecordBookController } from './record-book.controller';
import { RecordBookService } from './record-book.service';

@Module({
  imports: [AuditLogsModule],
  controllers: [RecordBookController],
  providers: [RecordBookService],
  exports: [RecordBookService],
})
export class RecordBookModule {}
