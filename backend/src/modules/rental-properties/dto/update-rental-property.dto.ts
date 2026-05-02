import { PartialType } from '@nestjs/mapped-types';
import { CreateRentalPropertyDto } from './create-rental-property.dto';
export class UpdateRentalPropertyDto extends PartialType(CreateRentalPropertyDto) {}
