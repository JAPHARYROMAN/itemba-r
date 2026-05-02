import { PartialType } from '@nestjs/mapped-types';
import { CreatePayrollEntryDto } from './create-payroll-entry.dto';
export class UpdatePayrollEntryDto extends PartialType(CreatePayrollEntryDto) {}
