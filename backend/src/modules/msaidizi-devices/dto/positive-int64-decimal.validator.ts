import { registerDecorator, ValidationOptions } from 'class-validator';

const MAX_SIGNED_INT64 = 9_223_372_036_854_775_807n;

/** Validates the canonical JSON string representation of a positive database BigInt. */
export function IsPositiveInt64Decimal(validationOptions?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyKey: string | symbol): void => {
    registerDecorator({
      name: 'isPositiveInt64Decimal',
      target: target.constructor,
      propertyName: String(propertyKey),
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) return false;
          try {
            return BigInt(value) <= MAX_SIGNED_INT64;
          } catch {
            return false;
          }
        },
        defaultMessage(): string {
          return '$property must be a canonical positive signed 64-bit decimal string';
        },
      },
    });
  };
}
