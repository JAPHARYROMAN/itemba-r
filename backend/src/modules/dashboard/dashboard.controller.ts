import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';

@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  /**
   * Full executive summary — aggregates all groups, companies, and governance
   * data into a single payload. Sensitive financial figures are included in the
   * response; the frontend is responsible for hiding them based on user permissions.
   */
  @Get('executive-summary')
  getExecutiveSummary() {
    return this.service.getExecutiveSummary();
  }
}
