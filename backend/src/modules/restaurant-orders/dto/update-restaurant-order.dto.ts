import { PartialType } from '@nestjs/mapped-types';
import { CreateRestaurantOrderDto } from './create-restaurant-order.dto';
export class UpdateRestaurantOrderDto extends PartialType(CreateRestaurantOrderDto) {}
