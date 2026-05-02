import { Controller, Get } from '@nestjs/common';
import { FinalQaDashboardService } from './final-qa-dashboard.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@Controller('final-qa')
export class FinalQaDashboardController {
  constructor(private readonly service: FinalQaDashboardService) {}

  @Get('dashboard')
  @RequirePermissions('final_qa.security_review')
  getDashboard() {
    return this.service.getDashboard();
  }
}
