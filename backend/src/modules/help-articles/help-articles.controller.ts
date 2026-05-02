import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { HelpArticlesService } from './help-articles.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('help/articles')
export class HelpArticlesController {
  constructor(private readonly service: HelpArticlesService) {}

  @Post()
  @RequirePermissions('help_articles.manage')
  create(@Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Get()
  @RequirePermissions('help_center.view')
  findAll(@Query() query: any, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('help_center.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions('help_articles.manage')
  update(@Param('id') id: string, @Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.id);
  }

  @Patch(':id/publish')
  @RequirePermissions('help_articles.publish')
  publish(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.publish(id, user.id);
  }

  @Patch(':id/archive')
  @RequirePermissions('help_articles.manage')
  archive(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.setStatus(id, 'ARCHIVED', user.id);
  }

  @Post(':id/mark-helpful')
  @RequirePermissions('help_center.view')
  markHelpful(@Param('id') id: string) {
    return this.service.incrementCount(id, 'helpfulCount');
  }

  @Post(':id/mark-not-helpful')
  @RequirePermissions('help_center.view')
  markNotHelpful(@Param('id') id: string) {
    return this.service.incrementCount(id, 'notHelpfulCount');
  }

  @Delete(':id')
  @RequirePermissions('help_articles.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id);
  }
}
