import { PartialType } from '@nestjs/mapped-types';
import { CreateParkingSessionDto } from './create-parking-session.dto';
export class UpdateParkingSessionDto extends PartialType(CreateParkingSessionDto) {}
