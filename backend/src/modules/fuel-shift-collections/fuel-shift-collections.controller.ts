import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { FuelShiftCollectionsService } from './fuel-shift-collections.service';
import { CreateFuelShiftCollectionDto } from './dto/create-fuel-shift-collection.dto';
import { UpdateFuelShiftCollectionDto } from './dto/update-fuel-shift-collection.dto';
import { QueryFuelShiftCollectionDto } from './dto/query-fuel-shift-collection.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('petroleum/fuel-shift-collections')
export class FuelShiftCollectionsController {
  constructor(private readonly service: FuelShiftCollectionsService) {}

  @Post()
  @RequirePermissions('fuel_collections.manage')
  create(@Body() dto: CreateFuelShiftCollectionDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Get()
  @RequirePermissions('fuel_collections.view')
  findAll(@Query() query: QueryFuelShiftCollectionDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get('shift/:shiftId')
  @RequirePermissions('fuel_collections.view')
  findByShift(@Param('shiftId') shiftId: string, @CurrentUser() user: AuthUser) {
    return this.service.findByShift(shiftId, user);
  }

  @Get(':id')
  @RequirePermissions('fuel_collections.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Patch(':id')
  @RequirePermissions('fuel_collections.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateFuelShiftCollectionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('fuel_collections.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
