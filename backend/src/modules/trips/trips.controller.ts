import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { TripsService } from './trips.service';
import { CreateTripDto } from './dto/create-trip.dto';
import { UpdateTripDto } from './dto/update-trip.dto';
import { TripStatus } from '@prisma/client';

@Controller('logistics/trips')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TripsController {
  constructor(private service: TripsService) {}

  @Post()
  @RequirePermissions('trips.create')
  create(@Body() dto: CreateTripDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Get()
  @RequirePermissions('trips.view')
  findAll(
    @Query('companyId') companyId?: string,
    @Query('status') status?: TripStatus,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @CurrentUser() user: AuthUser = undefined as unknown as AuthUser,
  ) {
    return this.service.findAll(
      companyId,
      status,
      page ? +page : 1,
      limit ? +limit : 20,
      user,
      from,
      to,
    );
  }

  @Get(':id')
  @RequirePermissions('trips.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Get(':id/profitability')
  @RequirePermissions('logistics.reports.view')
  getProfitability(@Param('id') id: string) {
    return this.service.getProfitability(id);
  }

  @Patch(':id/dispatch')
  @RequirePermissions('trips.dispatch')
  dispatch(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.dispatch(id, user.id);
  }

  @Patch(':id/in-transit')
  @RequirePermissions('trips.dispatch')
  markInTransit(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.markInTransit(id, user.id);
  }

  @Patch(':id/complete')
  @RequirePermissions('trips.complete')
  complete(
    @Param('id') id: string,
    @Body() body: { actualReturnDate: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.complete(id, body.actualReturnDate, user.id);
  }

  @Patch(':id/close')
  @RequirePermissions('trips.close')
  close(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.close(id, user);
  }

  @Patch(':id/cancel')
  @RequirePermissions('trips.close')
  cancel(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.cancel(id, user.id);
  }

  @Put(':id')
  @RequirePermissions('trips.create')
  update(@Param('id') id: string, @Body() dto: UpdateTripDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('trips.close')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id);
  }
}
