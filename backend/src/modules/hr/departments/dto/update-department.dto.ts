import { OmitType, PartialType } from '@nestjs/mapped-types';
import { IsOptional, IsString } from 'class-validator';
import { CreateDepartmentDto } from './create-department.dto';
export class UpdateDepartmentDto extends PartialType(
  OmitType(CreateDepartmentDto, ['divisionId', 'branchId'] as const),
) {
  @IsOptional() @IsString() divisionId?: string | null;
  @IsOptional() @IsString() branchId?: string | null;
}
