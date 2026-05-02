import { PartialType } from '@nestjs/mapped-types';
import { CreateLaborRecordDto } from './create-labor-record.dto';
export class UpdateLaborRecordDto extends PartialType(CreateLaborRecordDto) {}
