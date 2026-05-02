import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateStockDamageDto } from './create-stock-damage.dto';

export class UpdateStockDamageDto extends PartialType(OmitType(CreateStockDamageDto, ['companyId'] as const)) {}
