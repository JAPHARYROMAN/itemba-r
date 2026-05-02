import { Controller, Get, Post, Put, Delete, Body, Param } from '@nestjs/common';
import { JobQueueConfigsService } from './job-queue-configs.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@Controller('job-queue-configs')
export class JobQueueConfigsController {
  constructor(private readonly service: JobQueueConfigsService) {}

  @Get()
  @RequirePermissions('job_queue_configs.view')
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  @RequirePermissions('job_queue_configs.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('job_queue_configs.manage')
  create(@Body() dto: any) {
    return this.service.create(dto);
  }

  @Put(':id')
  @RequirePermissions('job_queue_configs.manage')
  update(@Param('id') id: string, @Body() dto: any) {
    return this.service.update(id, dto);
  }

  @Put(':id/activate')
  @RequirePermissions('job_queue_configs.manage')
  activate(@Param('id') id: string) {
    return this.service.setActive(id, true);
  }

  @Put(':id/deactivate')
  @RequirePermissions('job_queue_configs.manage')
  deactivate(@Param('id') id: string) {
    return this.service.setActive(id, false);
  }

  @Delete(':id')
  @RequirePermissions('job_queue_configs.manage')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
