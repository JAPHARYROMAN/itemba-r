import { PartialType } from '@nestjs/mapped-types';
import { CreateIntegrationMappingDto } from './create-integration-mapping.dto';

export class UpdateIntegrationMappingDto extends PartialType(CreateIntegrationMappingDto) {}
