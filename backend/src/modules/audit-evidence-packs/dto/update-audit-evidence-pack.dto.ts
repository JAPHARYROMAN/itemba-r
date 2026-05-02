import { PartialType } from '@nestjs/mapped-types';
import { CreateAuditEvidencePackDto } from './create-audit-evidence-pack.dto';
export class UpdateAuditEvidencePackDto extends PartialType(CreateAuditEvidencePackDto) {}
