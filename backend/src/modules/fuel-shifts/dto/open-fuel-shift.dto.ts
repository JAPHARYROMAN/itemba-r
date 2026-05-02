import {
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateIf,
  ValidateNested,
  ValidationArguments,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';
import { Type } from 'class-transformer';
import { FuelShiftType } from '@prisma/client';

function IsAttendantSpecified(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isAttendantSpecified',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(_value: unknown, args: ValidationArguments) {
          const obj = args.object as {
            attendantId?: string;
            employeeId?: string;
            attendantName?: string;
          };
          const set = [obj.attendantId, obj.employeeId, obj.attendantName].filter(
            (v) => typeof v === 'string' && v.trim().length > 0,
          );
          return set.length === 1;
        },
        defaultMessage() {
          return 'Exactly one of attendantId, employeeId, or attendantName must be provided';
        },
      },
    });
  };
}

export class ShiftAttendantAssignmentDto {
  @IsOptional()
  @IsString()
  attendantId?: string;

  @IsOptional()
  @IsString()
  employeeId?: string;

  @IsOptional()
  @IsString()
  attendantName?: string;

  @ValidateIf(() => true)
  @IsAttendantSpecified()
  _oneOf?: unknown;

  @IsOptional()
  @IsString()
  assignedPumpId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class OpenFuelShiftDto {
  @IsNotEmpty()
  @IsString()
  companyId!: string;

  @IsOptional()
  @IsString()
  divisionId?: string;

  @IsNotEmpty()
  @IsString()
  branchId!: string;

  @IsOptional()
  @IsEnum(FuelShiftType)
  shiftType?: FuelShiftType;

  @IsNotEmpty()
  @IsDateString()
  shiftDate!: string;

  @IsNotEmpty()
  @IsDateString()
  startTime!: string;

  @IsOptional()
  @IsString()
  notes?: string;

  /** Attendants for this shift, each optionally pinned to a specific pump. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ShiftAttendantAssignmentDto)
  attendants?: ShiftAttendantAssignmentDto[];

  /** @deprecated Use `attendants` instead. Kept for backward compatibility. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  attendantIds?: string[];
}
