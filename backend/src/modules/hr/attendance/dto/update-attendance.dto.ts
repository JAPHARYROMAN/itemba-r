import { OmitType, PartialType } from '@nestjs/mapped-types';
import { IsDateString, IsOptional } from 'class-validator';
import { CreateAttendanceDto } from './create-attendance.dto';
export class UpdateAttendanceDto extends PartialType(
  OmitType(CreateAttendanceDto, ['clockInTime', 'clockOutTime'] as const),
) {
  @IsOptional() @IsDateString() clockInTime?: string | null;
  @IsOptional() @IsDateString() clockOutTime?: string | null;
}
