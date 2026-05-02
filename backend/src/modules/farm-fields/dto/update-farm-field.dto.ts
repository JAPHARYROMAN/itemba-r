import { PartialType } from '@nestjs/mapped-types';
import { CreateFarmFieldDto } from './create-farm-field.dto';
export class UpdateFarmFieldDto extends PartialType(CreateFarmFieldDto) {}
