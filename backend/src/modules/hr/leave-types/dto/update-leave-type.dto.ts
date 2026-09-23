import { OmitType, PartialType } from '@nestjs/mapped-types';
import { IsNumber, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { CreateLeaveTypeDto } from './create-leave-type.dto';
export class UpdateLeaveTypeDto extends PartialType(
  OmitType(CreateLeaveTypeDto, ['annualAllowanceDays'] as const),
) {
  @IsOptional() @IsNumber() @Type(() => Number) annualAllowanceDays?: number | null;
}
