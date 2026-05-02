import { PartialType } from '@nestjs/mapped-types';
import { CreateSubcontractorDto } from './create-subcontractor.dto';
export class UpdateSubcontractorDto extends PartialType(CreateSubcontractorDto) {}
