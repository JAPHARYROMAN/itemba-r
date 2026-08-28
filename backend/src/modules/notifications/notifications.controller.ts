import { Controller, Get, Patch, Delete, Param, Query, UseGuards } from '@nestjs/common';
import { NotificationsQueryDto } from '../../common/dto/resource-query.dto';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';

@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get('unread-count')
  @RequirePermissions('notifications.view')
  getUnreadCount(@CurrentUser() user: AuthUser) {
    return this.service.getUnreadCount(user);
  }

  @Get('my')
  @RequirePermissions('notifications.view')
  findMy(@CurrentUser() user: AuthUser, @Query() query: NotificationsQueryDto) {
    return this.service.findMyNotifications(user, query);
  }

  @Get()
  @RequirePermissions('notifications.view')
  findAll(@CurrentUser() user: AuthUser, @Query() query: NotificationsQueryDto) {
    return this.service.findMyNotifications(user, query);
  }

  @Get(':id')
  @RequirePermissions('notifications.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Patch('mark-all-read')
  @RequirePermissions('notifications.view')
  markAllRead(@CurrentUser() user: AuthUser) {
    return this.service.markAllRead(user);
  }

  @Patch(':id/read')
  @RequirePermissions('notifications.view')
  markRead(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.markRead(id, user);
  }

  @Patch(':id/dismiss')
  @RequirePermissions('notifications.view')
  dismiss(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.dismiss(id, user);
  }

  @Delete(':id')
  @RequirePermissions('notifications.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
