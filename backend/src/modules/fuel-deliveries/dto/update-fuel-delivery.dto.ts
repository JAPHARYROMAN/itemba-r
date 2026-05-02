import { PartialType } from '@nestjs/mapped-types';
import { CreateFuelDeliveryDto } from './create-fuel-delivery.dto';

export class UpdateFuelDeliveryDto extends PartialType(CreateFuelDeliveryDto) {}
