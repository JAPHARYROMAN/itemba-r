import { PartialType } from '@nestjs/swagger';
import { CreateScheduledReportDto } from './create-scheduled-report.dto';

export class UpdateScheduledReportDto extends PartialType(CreateScheduledReportDto) {}
