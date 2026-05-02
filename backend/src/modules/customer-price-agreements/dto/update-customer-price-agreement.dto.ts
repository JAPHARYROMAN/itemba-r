import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateCustomerPriceAgreementDto } from './create-customer-price-agreement.dto';

export class UpdateCustomerPriceAgreementDto extends PartialType(OmitType(CreateCustomerPriceAgreementDto, ['companyId'] as const)) {}
