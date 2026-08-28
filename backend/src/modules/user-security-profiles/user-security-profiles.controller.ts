import { Controller, Get, Post, Patch, Body, Param, Query } from '@nestjs/common';
import { UserSecurityProfilesQueryDto } from '../../common/dto/resource-query.dto';
import { UserSecurityProfilesService } from './user-security-profiles.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { CreateUserSecurityProfileDto } from './dto/create-user-security-profile.dto';
import { UpdateUserSecurityProfileDto } from './dto/update-user-security-profile.dto';

@Controller('user-security-profiles')
export class UserSecurityProfilesController {
  constructor(private readonly service: UserSecurityProfilesService) {}

  @Get()
  @RequirePermissions('user_security_profiles.view')
  findAll(@Query() query: UserSecurityProfilesQueryDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('user_security_profiles.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('user_security_profiles.manage')
  create(@Body() dto: CreateUserSecurityProfileDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('user_security_profiles.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUserSecurityProfileDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user);
  }
}
