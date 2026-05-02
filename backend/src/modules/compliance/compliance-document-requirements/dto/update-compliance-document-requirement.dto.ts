import { PartialType } from '@nestjs/mapped-types';
import { CreateComplianceDocumentRequirementDto } from './create-compliance-document-requirement.dto';
export class UpdateComplianceDocumentRequirementDto extends PartialType(CreateComplianceDocumentRequirementDto) {}
