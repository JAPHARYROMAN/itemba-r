import { PartialType } from '@nestjs/mapped-types';
import { CreateHrDocumentDto } from './create-hr-document.dto';
export class UpdateHrDocumentDto extends PartialType(CreateHrDocumentDto) {}
