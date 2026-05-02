import { PartialType } from '@nestjs/mapped-types';
import { CreateBOQItemDto } from './create-boq-item.dto';
export class UpdateBOQItemDto extends PartialType(CreateBOQItemDto) {}
