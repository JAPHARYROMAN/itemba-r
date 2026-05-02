import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { RoutesService } from './routes.service';
import { CreateRouteDto } from './dto/create-route.dto';
import { UpdateRouteDto } from './dto/update-route.dto';

@Controller('logistics/routes')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RoutesController {
  constructor(private service: RoutesService) {}

  @Post() @RequirePermissions('routes.manage')
  create(@Body() dto: CreateRouteDto, @CurrentUser() user: AuthUser) { return this.service.create(dto, user.id); }

  @Get() @RequirePermissions('routes.view')
  findAll(@Query('companyId') companyId?: string, @Query('page') page?: string, @Query('limit') limit?: string, @CurrentUser() user: AuthUser = undefined as unknown as AuthUser) {
    return this.service.findAll(companyId, page ? +page : 1, limit ? +limit : 20, user);
  }

  @Get(':id') @RequirePermissions('routes.view')
  findOne(@Param('id') id: string) { return this.service.findOne(id); }

  @Put(':id') @RequirePermissions('routes.manage')
  update(@Param('id') id: string, @Body() dto: UpdateRouteDto, @CurrentUser() user: AuthUser) { return this.service.update(id, dto, user.id); }

  @Delete(':id') @RequirePermissions('routes.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.remove(id, user.id); }
}
