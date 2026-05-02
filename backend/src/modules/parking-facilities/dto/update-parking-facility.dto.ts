import { PartialType } from '@nestjs/mapped-types';
import { CreateParkingFacilityDto } from './create-parking-facility.dto';
export class UpdateParkingFacilityDto extends PartialType(CreateParkingFacilityDto) {}
