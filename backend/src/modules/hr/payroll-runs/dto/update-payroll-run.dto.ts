import { PartialType } from '@nestjs/mapped-types';
import { CreatePayrollRunDto } from './create-payroll-run.dto';
export class UpdatePayrollRunDto extends PartialType(CreatePayrollRunDto) {}
