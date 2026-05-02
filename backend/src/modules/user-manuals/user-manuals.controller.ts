import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { UserManualsService } from './user-manuals.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('documentation/manuals')
export class UserManualsController {
  constructor(private readonly service: UserManualsService) {}

  @Post()
  @RequirePermissions('documentation.manage')
  create(@Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Get()
  @RequirePermissions('documentation.view')
  findAll(@Query() query: any, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('documentation.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions('documentation.manage')
  update(@Param('id') id: string, @Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.id);
  }

  @Patch(':id/review')
  @RequirePermissions('documentation.manage')
  review(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.review(id, user.id);
  }

  @Patch(':id/publish')
  @RequirePermissions('documentation.publish')
  publish(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.publish(id, user.id);
  }

  @Patch(':id/archive')
  @RequirePermissions('documentation.manage')
  archive(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.setStatus(id, 'ARCHIVED', user.id);
  }

  @Delete(':id')
  @RequirePermissions('documentation.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id);
  }
}
