import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { GuestsService } from './guests.service';
import { CreateGuestDto } from './dto/create-guest.dto';
import { UpdateGuestDto } from './dto/update-guest.dto';
import { GuestStatus } from '@prisma/client';

@Controller('guests')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class GuestsController {
  constructor(private service: GuestsService) {}

  @Post()
  @RequirePermissions('guests.manage')
  create(@Body() dto: CreateGuestDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Get()
  @RequirePermissions('guests.view')
  findAll(
    @Query('companyId') companyId?: string,
    @Query('status') status?: GuestStatus,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string, @CurrentUser() user: AuthUser = undefined as unknown as AuthUser,
  ) {
    return this.service.findAll(companyId, status, search, page ? +page : 1, limit ? +limit : 20, user);
  }

  @Get(':id')
  @RequirePermissions('guests.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions('guests.manage')
  update(@Param('id') id: string, @Body() dto: UpdateGuestDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermissions('guests.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id);
  }
}
