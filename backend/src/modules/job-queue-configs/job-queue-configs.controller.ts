import { Controller, Get, Post, Put, Delete, Body, Param } from '@nestjs/common';
import { JobQueueConfigsService } from './job-queue-configs.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CreateJobQueueConfigDto, UpdateJobQueueConfigDto } from './dto/job-queue-config.dto';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

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
  create(@Body() dto: CreateJobQueueConfigDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Put(':id')
  @RequirePermissions('job_queue_configs.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateJobQueueConfigDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user.id);
  }

  @Put(':id/activate')
  @RequirePermissions('job_queue_configs.manage')
  activate(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.setActive(id, true, user.id);
  }

  @Put(':id/deactivate')
  @RequirePermissions('job_queue_configs.manage')
  deactivate(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.setActive(id, false, user.id);
  }

  @Delete(':id')
  @RequirePermissions('job_queue_configs.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
