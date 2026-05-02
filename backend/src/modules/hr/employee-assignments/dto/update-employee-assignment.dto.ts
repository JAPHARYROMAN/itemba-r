import { PartialType } from '@nestjs/mapped-types';
import { CreateEmployeeAssignmentDto } from './create-employee-assignment.dto';
export class UpdateEmployeeAssignmentDto extends PartialType(CreateEmployeeAssignmentDto) {}
