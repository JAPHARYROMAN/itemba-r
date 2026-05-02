import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { MonitoringService } from '../modules/monitoring/monitoring.service';
import { Public } from './decorators/public.decorator';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly monitoring: MonitoringService) {}

  @Public()
  @Get()
  async check() {
    return this.monitoring.getPublicHealth();
  }

  @Public()
  @Get('live')
  live() {
    return {
      status: 'ok',
      service: 'itemba-r-api',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }

  @Public()
  @Get('ready')
  async ready() {
    return this.monitoring.getPublicHealth();
  }
}
