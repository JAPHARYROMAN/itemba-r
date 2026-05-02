import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { AssignRolesDto } from './dto/assign-roles.dto';
import { GrantCompanyAccessDto } from './dto/grant-company-access.dto';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions('users.read')
  findAll(@CurrentUser() user: AuthUser, @Query() query: any) {
    return this.users.findAll(user, query);
  }

  @Get(':id')
  @RequirePermissions('users.read')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.users.findById(id, user);
  }

  @Post()
  @RequirePermissions('users.create')
  create(@Body() dto: CreateUserDto, @CurrentUser() user: AuthUser) {
    return this.users.create(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('users.update')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto, @CurrentUser() user: AuthUser) {
    return this.users.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('users.delete')
  @ApiOperation({
    summary:
      'Soft-deactivate a user. Sets status=INACTIVE, marks deletedAt, and revokes refresh tokens.',
  })
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.users.remove(id, user);
  }

  /** Replace the user's role set. Empty array removes all roles. */
  @Put(':id/roles')
  @RequirePermissions('users.assign_roles')
  @ApiOperation({ summary: 'Assign / replace the role set for a user' })
  assignRoles(@Param('id') id: string, @Body() dto: AssignRolesDto, @CurrentUser() user: AuthUser) {
    return this.users.assignRoles(id, dto, user);
  }

  /** Replace the user's company-access set. */
  @Put(':id/company-access')
  @RequirePermissions('users.assign_roles')
  @ApiOperation({ summary: 'Grant or replace company access entries for a user' })
  grantCompanyAccess(
    @Param('id') id: string,
    @Body() dto: GrantCompanyAccessDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.users.grantCompanyAccess(id, dto, user);
  }
}
