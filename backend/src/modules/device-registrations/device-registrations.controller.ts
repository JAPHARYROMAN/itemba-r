import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { DeviceRegistrationsService } from './device-registrations.service';
import { CreateDeviceRegistrationDto } from './dto/create-device-registration.dto';
import { UpdateDeviceRegistrationDto } from './dto/update-device-registration.dto';
import { QueryDeviceRegistrationDto } from './dto/query-device-registration.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('device-registrations')
export class DeviceRegistrationsController {
  constructor(private readonly service: DeviceRegistrationsService) {}

  @Get()
  @RequirePermissions('devices.view')
  findAll(@Query() query: QueryDeviceRegistrationDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('devices.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('devices.manage')
  create(@Body() dto: CreateDeviceRegistrationDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Patch(':id')
  @RequirePermissions('devices.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateDeviceRegistrationDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user.id);
  }

  @Post(':id/block')
  @RequirePermissions('devices.block')
  block(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.block(id, user.id);
  }

  @Post(':id/revoke')
  @RequirePermissions('devices.block')
  revoke(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.revoke(id, user.id);
  }
}
