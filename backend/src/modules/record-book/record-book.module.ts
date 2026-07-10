import { Module } from '@nestjs/common';
import { CompanyScopeService } from '../../common/services';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { RecordBookController } from './record-book.controller';
import { RecordBookService } from './record-book.service';

@Module({
  imports: [AuditLogsModule],
  controllers: [RecordBookController],
  providers: [RecordBookService, CompanyScopeService],
  exports: [RecordBookService],
})
export class RecordBookModule {}
