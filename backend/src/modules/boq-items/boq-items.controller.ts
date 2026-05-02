import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { BOQItemsService } from './boq-items.service';
import { CreateBOQItemDto } from './dto/create-boq-item.dto';
import { UpdateBOQItemDto } from './dto/update-boq-item.dto';

@Controller('construction/boq-items')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class BOQItemsController {
  constructor(private service: BOQItemsService) {}

  @Post() @RequirePermissions('boq.manage')
  create(@Body() dto: CreateBOQItemDto, @CurrentUser() user: AuthUser) { return this.service.create(dto, user.id); }

  @Get() @RequirePermissions('boq.view')
  findAll(@Query('projectId') projectId?: string, @Query('companyId') companyId?: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.service.findAll(projectId, companyId, page ? +page : 1, limit ? +limit : 50);
  }

  @Get(':id') @RequirePermissions('boq.view')
  findOne(@Param('id') id: string) { return this.service.findOne(id); }

  @Put(':id') @RequirePermissions('boq.manage')
  update(@Param('id') id: string, @Body() dto: UpdateBOQItemDto, @CurrentUser() user: AuthUser) { return this.service.update(id, dto, user.id); }

  @Delete(':id') @RequirePermissions('boq.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.remove(id, user.id); }
}
