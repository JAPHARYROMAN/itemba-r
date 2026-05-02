import { PartialType } from '@nestjs/mapped-types';
import { CreateRoomBookingDto } from './create-room-booking.dto';
export class UpdateRoomBookingDto extends PartialType(CreateRoomBookingDto) {}
