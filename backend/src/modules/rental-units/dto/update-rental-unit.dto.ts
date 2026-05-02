import { PartialType } from '@nestjs/mapped-types';
import { CreateRentalUnitDto } from './create-rental-unit.dto';
export class UpdateRentalUnitDto extends PartialType(CreateRentalUnitDto) {}
