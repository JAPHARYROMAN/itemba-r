import { PartialType } from '@nestjs/mapped-types';
import { CreateTaxFilingPeriodDto } from './create-tax-filing-period.dto';
export class UpdateTaxFilingPeriodDto extends PartialType(CreateTaxFilingPeriodDto) {}
