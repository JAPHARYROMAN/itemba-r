import { Controller, Get } from '@nestjs/common';
import { DeploymentService } from './deployment.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@Controller('deployment')
export class DeploymentController {
  constructor(private readonly service: DeploymentService) {}

  @Get('dashboard')
  @RequirePermissions('deployment.dashboard.view')
  getDashboard() {
    return this.service.getDashboard();
  }
}
