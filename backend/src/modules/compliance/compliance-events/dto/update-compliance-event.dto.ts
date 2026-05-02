import { PartialType } from '@nestjs/mapped-types';
import { CreateComplianceEventDto } from './create-compliance-event.dto';
export class UpdateComplianceEventDto extends PartialType(CreateComplianceEventDto) {}
