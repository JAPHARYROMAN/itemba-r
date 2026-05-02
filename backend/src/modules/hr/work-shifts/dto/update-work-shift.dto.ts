import { PartialType } from '@nestjs/mapped-types';
import { CreateWorkShiftDto } from './create-work-shift.dto';
export class UpdateWorkShiftDto extends PartialType(CreateWorkShiftDto) {}
