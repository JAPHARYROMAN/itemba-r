import { PartialType } from '@nestjs/mapped-types';
import { CreateMobileMoneyAccountDto } from './create-mobile-money-account.dto';

export class UpdateMobileMoneyAccountDto extends PartialType(CreateMobileMoneyAccountDto) {}
