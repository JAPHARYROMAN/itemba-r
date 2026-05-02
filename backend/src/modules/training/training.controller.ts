import { Controller, Get } from '@nestjs/common';
import { TrainingService } from './training.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
@Controller('training')
export class TrainingController {
  constructor(private readonly service: TrainingService) {}

  @Get('summary')
  @RequirePermissions('training.dashboard.view')
  getSummary() {
    return this.service.getDashboardSummary();
  }

  @Get('dashboard/summary')
  @RequirePermissions('training.dashboard.view')
  getDashboardSummary() {
    return this.service.getDashboardSummary();
  }
}
