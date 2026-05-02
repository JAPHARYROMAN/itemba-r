import { Controller, Get } from '@nestjs/common';
import { DataIsolationService } from './data-isolation.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@Controller('data-isolation')
export class DataIsolationController {
  constructor(private readonly service: DataIsolationService) {}

  @Get('dashboard')
  @RequirePermissions('data_isolation.view')
  getDashboard() {
    return this.service.getDashboard();
  }
}
