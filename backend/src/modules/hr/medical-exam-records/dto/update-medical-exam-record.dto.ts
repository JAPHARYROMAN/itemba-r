import { PartialType } from '@nestjs/mapped-types';
import { CreateMedicalExamRecordDto } from './create-medical-exam-record.dto';

export class UpdateMedicalExamRecordDto extends PartialType(CreateMedicalExamRecordDto) {}
