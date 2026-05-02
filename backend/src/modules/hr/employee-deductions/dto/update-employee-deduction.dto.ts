import { PartialType } from '@nestjs/mapped-types';
import { CreateEmployeeDeductionDto } from './create-employee-deduction.dto';
export class UpdateEmployeeDeductionDto extends PartialType(CreateEmployeeDeductionDto) {}
