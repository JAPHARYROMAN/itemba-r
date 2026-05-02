import { PartialType } from '@nestjs/mapped-types';
import { CreateProjectBillingDto } from './create-project-billing.dto';
export class UpdateProjectBillingDto extends PartialType(CreateProjectBillingDto) {}
