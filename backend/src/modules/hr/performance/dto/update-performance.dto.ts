import { PartialType } from '@nestjs/mapped-types';
import { CreatePerformanceRecordDto } from './create-performance.dto';
export class UpdatePerformanceRecordDto extends PartialType(CreatePerformanceRecordDto) {}
