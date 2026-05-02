import { PartialType } from '@nestjs/mapped-types';
import { CreateItembaWorkUnitDto } from './create-itemba-work-unit.dto';
export class UpdateItembaWorkUnitDto extends PartialType(CreateItembaWorkUnitDto) {}
