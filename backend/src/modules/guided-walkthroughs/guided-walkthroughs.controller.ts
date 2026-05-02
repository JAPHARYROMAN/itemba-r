import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { GuidedWalkthroughsService } from './guided-walkthroughs.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
@Controller('training')
export class GuidedWalkthroughsController {
  constructor(private readonly service: GuidedWalkthroughsService) {}
  @Post('walkthroughs') @RequirePermissions('guided_walkthroughs.manage') create(@Body() dto: any, @CurrentUser() user: AuthUser) { return this.service.create(dto, user.id); }
  @Get('walkthroughs') @RequirePermissions('guided_walkthroughs.view') findAll(@Query() query: any) { return this.service.findAll(query); }
  @Get('walkthroughs/route') @RequirePermissions('guided_walkthroughs.view') findByRoute(@Query('path') path: string) { return this.service.findByRoute(path); }
  @Get('walkthroughs/:id') @RequirePermissions('guided_walkthroughs.view') findOne(@Param('id') id: string) { return this.service.findOne(id); }
  @Patch('walkthroughs/:id') @RequirePermissions('guided_walkthroughs.manage') update(@Param('id') id: string, @Body() dto: any, @CurrentUser() user: AuthUser) { return this.service.update(id, dto, user.id); }
  @Patch('walkthroughs/:id/activate') @RequirePermissions('guided_walkthroughs.manage') activate(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.setStatus(id, 'ACTIVE', user.id); }
  @Patch('walkthroughs/:id/deactivate') @RequirePermissions('guided_walkthroughs.manage') deactivate(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.setStatus(id, 'INACTIVE', user.id); }
  @Delete('walkthroughs/:id') @RequirePermissions('guided_walkthroughs.manage') remove(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.remove(id, user.id); }
  @Patch('walkthrough-progress/:id/start') @RequirePermissions('guided_walkthroughs.view') startProgress(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.startProgress(id, user.id); }
  @Patch('walkthrough-progress/:id/step') @RequirePermissions('guided_walkthroughs.view') stepProgress(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.stepProgress(id, user.id); }
  @Patch('walkthrough-progress/:id/complete') @RequirePermissions('guided_walkthroughs.view') completeProgress(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.completeProgress(id, user.id); }
  @Patch('walkthrough-progress/:id/dismiss') @RequirePermissions('guided_walkthroughs.view') dismissProgress(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.dismissProgress(id, user.id); }
}
