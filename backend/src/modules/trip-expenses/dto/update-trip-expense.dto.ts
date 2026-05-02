import { PartialType } from '@nestjs/mapped-types';
import { CreateTripExpenseDto } from './create-trip-expense.dto';
export class UpdateTripExpenseDto extends PartialType(CreateTripExpenseDto) {}
