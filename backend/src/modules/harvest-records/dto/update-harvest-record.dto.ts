import { PartialType } from '@nestjs/mapped-types';
import { CreateHarvestRecordDto } from './create-harvest-record.dto';
export class UpdateHarvestRecordDto extends PartialType(CreateHarvestRecordDto) {}
