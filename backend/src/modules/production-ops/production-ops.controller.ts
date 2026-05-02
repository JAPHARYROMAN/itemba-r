import { Controller, Get } from '@nestjs/common';
import { ProductionOpsService } from './production-ops.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@Controller('production-ops')
export class ProductionOpsController {
  constructor(private readonly service: ProductionOpsService) {}

  @Get('dashboard')
  @RequirePermissions('production_ops.dashboard.view')
  getDashboard() {
    return this.service.getDashboard();
  }
}
