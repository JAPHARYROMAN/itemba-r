import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from './decorators/public.decorator';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async check() {
    return this.probe();
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
    return this.probe();
  }

  /**
   * Minimal load-balancer probe: a DB ping is the one dependency that makes
   * the API unusable when down. Replaces the former MonitoringService-based
   * health report (monitoring module removed in the Westsides tone-down).
   */
  private async probe() {
    const startedAt = Date.now();
    let database: 'up' | 'down' = 'down';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = 'up';
    } catch {
      database = 'down';
    }
    return {
      status: database === 'up' ? 'ok' : 'critical',
      service: 'itemba-r-api',
      database,
      responseTimeMs: Date.now() - startedAt,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }
}
