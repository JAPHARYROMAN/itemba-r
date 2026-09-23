import { OmitType, PartialType } from '@nestjs/mapped-types';
import { IsDateString, IsOptional, IsString } from 'class-validator';
import { CreateEmployeeAssignmentDto } from './create-employee-assignment.dto';
export class UpdateEmployeeAssignmentDto extends PartialType(
  OmitType(CreateEmployeeAssignmentDto, ['endDate', 'branchId'] as const),
) {
  @IsOptional() @IsDateString() endDate?: string | null;
  @IsOptional() @IsString() branchId?: string | null;
}
