import { PartialType } from '@nestjs/mapped-types';
import { CreateStatutoryDeductionRuleDto } from './create-statutory-deduction-rule.dto';
export class UpdateStatutoryDeductionRuleDto extends PartialType(CreateStatutoryDeductionRuleDto) {}
