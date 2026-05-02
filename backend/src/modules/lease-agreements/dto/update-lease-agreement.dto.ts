import { PartialType } from '@nestjs/mapped-types';
import { CreateLeaseAgreementDto } from './create-lease-agreement.dto';
export class UpdateLeaseAgreementDto extends PartialType(CreateLeaseAgreementDto) {}
