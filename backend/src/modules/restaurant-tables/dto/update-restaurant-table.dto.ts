import { PartialType } from '@nestjs/mapped-types';
import { CreateRestaurantTableDto } from './create-restaurant-table.dto';
export class UpdateRestaurantTableDto extends PartialType(CreateRestaurantTableDto) {}
