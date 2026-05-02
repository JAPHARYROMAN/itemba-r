import { PartialType } from '@nestjs/mapped-types';
import { CreateConstructionSiteDto } from './create-construction-site.dto';
export class UpdateConstructionSiteDto extends PartialType(CreateConstructionSiteDto) {}
