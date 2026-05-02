import { Controller, Get } from '@nestjs/common';
import { BackupsService } from './backups.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@Controller('backups')
export class BackupsController {
  constructor(private readonly service: BackupsService) {}

  @Get('dashboard')
  @RequirePermissions('backups.dashboard.view')
  dashboard() {
    return this.service.getDashboard();
  }
}
