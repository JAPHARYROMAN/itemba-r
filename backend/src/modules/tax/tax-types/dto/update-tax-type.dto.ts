import { PartialType } from '@nestjs/mapped-types';
import { CreateTaxTypeDto } from './create-tax-type.dto';
export class UpdateTaxTypeDto extends PartialType(CreateTaxTypeDto) {}
