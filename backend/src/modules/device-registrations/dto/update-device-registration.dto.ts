import { PartialType } from '@nestjs/mapped-types';
import { CreateDeviceRegistrationDto } from './create-device-registration.dto';

export class UpdateDeviceRegistrationDto extends PartialType(CreateDeviceRegistrationDto) {}
