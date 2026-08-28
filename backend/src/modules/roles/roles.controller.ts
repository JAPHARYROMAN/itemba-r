import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { RolesService } from './roles.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

@ApiTags('roles')
@ApiBearerAuth()
@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermissions('roles.read')
  findAll() {
    return this.roles.findAll();
  }

  @Get(':id')
  @RequirePermissions('roles.read')
  findOne(@Param('id') id: string) {
    return this.roles.findOne(id);
  }

  @Post()
  @RequirePermissions('roles.create')
  create(@Body() dto: CreateRoleDto, @CurrentUser() user: AuthUser) {
    return this.roles.create(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('roles.update')
  update(@Param('id') id: string, @Body() dto: UpdateRoleDto, @CurrentUser() user: AuthUser) {
    return this.roles.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('roles.delete')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.roles.remove(id, user);
  }
}
