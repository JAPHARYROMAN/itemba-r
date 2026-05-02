import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { RoomBookingsService } from './room-bookings.service';
import { CreateRoomBookingDto } from './dto/create-room-booking.dto';
import { UpdateRoomBookingDto } from './dto/update-room-booking.dto';
import { RoomBookingStatus } from '@prisma/client';

@Controller('room-bookings')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RoomBookingsController {
  constructor(private service: RoomBookingsService) {}

  @Post()
  @RequirePermissions('room_bookings.create')
  create(@Body() dto: CreateRoomBookingDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Get()
  @RequirePermissions('room_bookings.view')
  findAll(
    @Query('companyId') companyId?: string,
    @Query('hospitalityFacilityId') hospitalityFacilityId?: string,
    @Query('guestId') guestId?: string,
    @Query('roomId') roomId?: string,
    @Query('status') status?: RoomBookingStatus,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.findAll(companyId, hospitalityFacilityId, guestId, roomId, status, page ? +page : 1, limit ? +limit : 20);
  }

  @Get(':id')
  @RequirePermissions('room_bookings.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions('room_bookings.create')
  update(@Param('id') id: string, @Body() dto: UpdateRoomBookingDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.id);
  }

  @Post(':id/check-in')
  @RequirePermissions('room_bookings.check_in')
  checkIn(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.checkIn(id, user.id);
  }

  @Post(':id/check-out')
  @RequirePermissions('room_bookings.check_out')
  checkOut(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.checkOut(id, user.id);
  }

  @Post(':id/cancel')
  @RequirePermissions('room_bookings.cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.cancel(id, user.id);
  }
}
