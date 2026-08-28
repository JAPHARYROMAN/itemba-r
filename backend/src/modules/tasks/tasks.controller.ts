import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { MyTasksQueryDto, TasksQueryDto } from '../../common/dto/resource-query.dto';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';

@ApiTags('Tasks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('tasks')
export class TasksController {
  constructor(private readonly service: TasksService) {}

  @Get('my-tasks')
  @RequirePermissions('tasks.view')
  myTasks(@CurrentUser() user: AuthUser, @Query() query: MyTasksQueryDto) {
    return this.service.findMyTasks(user, query);
  }

  @Get()
  @RequirePermissions('tasks.view')
  findAll(@CurrentUser() user: AuthUser, @Query() query: TasksQueryDto) {
    return this.service.findAll(user, query);
  }

  @Get(':id')
  @RequirePermissions('tasks.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('tasks.create')
  create(@Body() dto: CreateTaskDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('tasks.update')
  update(@Param('id') id: string, @Body() dto: UpdateTaskDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  @Patch(':id/complete')
  @RequirePermissions('tasks.complete')
  complete(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.complete(id, user);
  }

  @Patch(':id/cancel')
  @RequirePermissions('tasks.cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.cancel(id, user);
  }

  @Delete(':id')
  @RequirePermissions('tasks.update')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
