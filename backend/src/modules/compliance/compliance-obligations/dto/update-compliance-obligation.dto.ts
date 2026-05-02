import { PartialType } from '@nestjs/mapped-types';
import { CreateComplianceObligationDto } from './create-compliance-obligation.dto';
export class UpdateComplianceObligationDto extends PartialType(CreateComplianceObligationDto) {}
