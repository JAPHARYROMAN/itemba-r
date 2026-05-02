import { PartialType } from '@nestjs/mapped-types';
import { CreateParkingRateDto } from './create-parking-rate.dto';
export class UpdateParkingRateDto extends PartialType(CreateParkingRateDto) {}
