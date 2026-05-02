import { Controller, Get, Post, Patch, Body, Param, Query } from '@nestjs/common';
import { UserSecurityProfilesService } from './user-security-profiles.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('user-security-profiles')
export class UserSecurityProfilesController {
  constructor(private readonly service: UserSecurityProfilesService) {}

  @Get()
  @RequirePermissions('user_security_profiles.view')
  findAll(@Query() query: any, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('user_security_profiles.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('user_security_profiles.manage')
  create(@Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('user_security_profiles.manage')
  update(@Param('id') id: string, @Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }
}
