import { Controller, Get } from '@nestjs/common';
import { QaService } from './qa.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@Controller('qa')
export class QaController {
  constructor(private readonly service: QaService) {}

  @Get('dashboard/summary')
  @RequirePermissions('qa.dashboard.view')
  getDashboardSummary() {
    return this.service.getDashboardSummary();
  }
}
