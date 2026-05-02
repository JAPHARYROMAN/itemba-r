import { PartialType } from '@nestjs/mapped-types';
import { CreateEmployeeAllowanceDto } from './create-employee-allowance.dto';
export class UpdateEmployeeAllowanceDto extends PartialType(CreateEmployeeAllowanceDto) {}
