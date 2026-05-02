import { PartialType } from '@nestjs/mapped-types';
import { CreateParkingZoneDto } from './create-parking-zone.dto';
export class UpdateParkingZoneDto extends PartialType(CreateParkingZoneDto) {}
