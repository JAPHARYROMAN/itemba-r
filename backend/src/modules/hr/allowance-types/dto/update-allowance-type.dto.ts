import { PartialType } from '@nestjs/mapped-types';
import { CreateAllowanceTypeDto } from './create-allowance-type.dto';
export class UpdateAllowanceTypeDto extends PartialType(CreateAllowanceTypeDto) {}
