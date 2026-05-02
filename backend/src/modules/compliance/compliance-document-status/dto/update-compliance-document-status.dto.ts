import { PartialType } from '@nestjs/mapped-types';
import { CreateComplianceDocumentStatusDto } from './create-compliance-document-status.dto';
export class UpdateComplianceDocumentStatusDto extends PartialType(CreateComplianceDocumentStatusDto) {}
