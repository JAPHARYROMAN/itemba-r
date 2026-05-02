import { Controller, Patch, Body, Param } from '@nestjs/common';
import { LaunchReadinessItemsService } from './launch-readiness-items.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('launch/readiness-items')
export class LaunchReadinessItemsController {
  constructor(private readonly service: LaunchReadinessItemsService) {}

  @Patch(':id')
  @RequirePermissions('launch.readiness_items.manage')
  update(@Param('id') id: string, @Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.id);
  }

  @Patch(':id/mark-passed')
  @RequirePermissions('launch.readiness_items.manage')
  markPassed(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.markPassed(id, user.id);
  }

  @Patch(':id/mark-failed')
  @RequirePermissions('launch.readiness_items.manage')
  markFailed(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.setStatus(id, 'FAILED', user.id);
  }

  @Patch(':id/waive')
  @RequirePermissions('launch.readiness_items.manage')
  waive(@Param('id') id: string, @Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.waive(id, dto, user.id);
  }
}
