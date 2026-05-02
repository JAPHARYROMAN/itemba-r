import {
  IsOptional,
  IsString,
  ValidateIf,
  ValidationArguments,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';

/**
 * Pump-attendant assignment payload.
 *
 * Exactly one of `attendantId`, `employeeId`, `attendantName` must be set:
 *  - `attendantId` — system User (legacy / for users with login access)
 *  - `employeeId`  — payroll Employee (preferred — pump attendants are
 *    typically paid via payroll, may not have a system login)
 *  - `attendantName` — free-text label for ad-hoc / casual workers not yet on
 *    the payroll register
 */
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

export class AddShiftAttendantDto {
  @IsOptional()
  @IsString()
  attendantId?: string;

  @IsOptional()
  @IsString()
  employeeId?: string;

  @IsOptional()
  @IsString()
  attendantName?: string;

  // Trigger the cross-field validator on this synthetic property — class-validator
  // requires a hook, but the value itself isn't read. Always declared optional
  // so the validator runs regardless of which key the client sent.
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

export class UpdateShiftAttendantDto {
  @IsOptional()
  @IsString()
  assignedPumpId?: string | null;

  @IsOptional()
  @IsString()
  notes?: string | null;
}
