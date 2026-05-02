import { Controller, Get } from '@nestjs/common';
import { ScalabilityService } from './scalability.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@Controller('scalability')
export class ScalabilityController {
  constructor(private readonly service: ScalabilityService) {}

  @Get('dashboard')
  @RequirePermissions('scalability.dashboard.view')
  getDashboard() {
    return this.service.getDashboard();
  }
}
