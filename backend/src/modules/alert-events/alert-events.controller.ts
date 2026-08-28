import { Controller, Get, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { AlertEventsQueryDto } from '../../common/dto/resource-query.dto';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { AlertEventsService } from './alert-events.service';
import { IsOptional, IsString } from 'class-validator';

class AlertEventCommentDto {
  @IsOptional()
  @IsString()
  comment?: string;
}

@ApiTags('Alert Events')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('alert-events')
export class AlertEventsController {
  constructor(private readonly service: AlertEventsService) {}

  @Get()
  @RequirePermissions('alert_events.view')
  findAll(@CurrentUser() user: AuthUser, @Query() query: AlertEventsQueryDto) {
    return this.service.findAll(user, query);
  }

  @Get(':id')
  @RequirePermissions('alert_events.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Patch(':id/acknowledge')
  @RequirePermissions('alert_events.acknowledge')
  acknowledge(
    @Param('id') id: string,
    @Body() body: AlertEventCommentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.acknowledge(id, body, user);
  }

  @Patch(':id/resolve')
  @RequirePermissions('alert_events.resolve')
  resolve(
    @Param('id') id: string,
    @Body() body: AlertEventCommentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.resolve(id, body, user);
  }

  @Patch(':id/dismiss')
  @RequirePermissions('alert_events.dismiss')
  dismiss(
    @Param('id') id: string,
    @Body() body: AlertEventCommentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.dismiss(id, body, user);
  }
}
