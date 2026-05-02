import { PartialType } from '@nestjs/mapped-types';
import { CreateTaxCodeDto } from './create-tax-code.dto';
export class UpdateTaxCodeDto extends PartialType(CreateTaxCodeDto) {}
