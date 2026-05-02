import { PartialType } from '@nestjs/mapped-types';
import { CreateOshaRegistrationDto } from './create-osha-registration.dto';

export class UpdateOshaRegistrationDto extends PartialType(CreateOshaRegistrationDto) {}
