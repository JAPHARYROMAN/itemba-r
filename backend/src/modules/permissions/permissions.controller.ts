import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PermissionsService } from './permissions.service';
import { CreatePermissionDto } from './dto/create-permission.dto';

/**
 * Permission catalog endpoints.
 *
 * Reads are gated by the standard @RequirePermissions('permissions.read')
 * permission — this is the right level. Permissions themselves are metadata
 * (codes + descriptions), not sensitive data, and anyone managing roles
 * needs to see the catalog to build a role's permission set.
 *
 * Mutations (POST / DELETE) remain restricted to GROUP_SUPER_ADMIN — the
 * permission catalog is structural and changing it can shift the security
 * model of the whole app, so it should not be a routine administrative
 * action.
 */
@ApiTags('permissions')
@ApiBearerAuth()
@Controller('permissions')
export class PermissionsController {
  constructor(private readonly service: PermissionsService) {}

  @Get()
  @RequirePermissions('permissions.read')
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  @RequirePermissions('permissions.read')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Roles('GROUP_SUPER_ADMIN')
  @RequirePermissions('permissions.create')
  create(@Body() dto: CreatePermissionDto) {
    return this.service.create(dto);
  }

  @Delete(':id')
  @Roles('GROUP_SUPER_ADMIN')
  @RequirePermissions('permissions.delete')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
