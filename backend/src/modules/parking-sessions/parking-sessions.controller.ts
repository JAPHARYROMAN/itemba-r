import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { ParkingSessionsService } from './parking-sessions.service';
import { CreateParkingSessionDto } from './dto/create-parking-session.dto';
import { UpdateParkingSessionDto } from './dto/update-parking-session.dto';
import { ParkingSessionStatus, ParkingPaymentStatus } from '@prisma/client';
import { IsString, IsOptional, IsDateString } from 'class-validator';

class CloseSessionDto {
  @IsDateString() @IsOptional() exitTime?: string;
  @IsString() @IsOptional() rateId?: string;
  @IsString() closedById!: string;
}

@Controller('parking-sessions')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ParkingSessionsController {
  constructor(private service: ParkingSessionsService) {}

  @Post()
  @RequirePermissions('parking_sessions.create')
  create(@Body() dto: CreateParkingSessionDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Get()
  @RequirePermissions('parking_sessions.view')
  findAll(
    @Query('companyId') companyId?: string,
    @Query('facilityId') facilityId?: string,
    @Query('zoneId') zoneId?: string,
    @Query('status') status?: ParkingSessionStatus,
    @Query('paymentStatus') paymentStatus?: ParkingPaymentStatus,
    @Query('page') page?: string,
    @Query('limit') limit?: string, @CurrentUser() user: AuthUser = undefined as unknown as AuthUser,
  ) {
    return this.service.findAll(companyId, facilityId, zoneId, status, paymentStatus, page ? +page : 1, limit ? +limit : 20, user);
  }

  @Get(':id')
  @RequirePermissions('parking_sessions.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Patch(':id')
  @RequirePermissions('parking_sessions.create')
  update(@Param('id') id: string, @Body() dto: UpdateParkingSessionDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.id, user);
  }

  @Post(':id/close')
  @RequirePermissions('parking_sessions.close')
  close(@Param('id') id: string, @Body() body: CloseSessionDto, @CurrentUser() user: AuthUser) {
    return this.service.close(id, body, user.id, user);
  }

  @Post(':id/void')
  @RequirePermissions('parking_sessions.void')
  void(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.voidSession(id, user.id, user);
  }

  @Delete(':id')
  @RequirePermissions('parking_sessions.create')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id, user);
  }
}
