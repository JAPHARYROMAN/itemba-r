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
import { UnitsService } from './units.service';
import { CreateUnitDto } from './dto/create-unit.dto';
import { UpdateUnitDto } from './dto/update-unit.dto';
import { QueryUnitDto } from './dto/query-unit.dto';
import { CreateUnitConversionDto } from './dto/create-unit-conversion.dto';
import { UpdateUnitConversionDto } from './dto/update-unit-conversion.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller()
export class UnitsController {
  constructor(private readonly service: UnitsService) {}

  // ─── Units ───────────────────────────────────────────────────────────────

  @Get('units')
  @RequirePermissions('units.view')
  findAllUnits(@Query() query: QueryUnitDto, @CurrentUser() user: AuthUser) {
    return this.service.findAllUnits(query, user);
  }

  @Get('units/:id')
  @RequirePermissions('units.view')
  findOneUnit(@Param('id') id: string) {
    return this.service.findOneUnit(id);
  }

  @Post('units')
  @RequirePermissions('units.manage')
  createUnit(@Body() dto: CreateUnitDto, @CurrentUser() user: AuthUser) {
    return this.service.createUnit(dto, user.id);
  }

  @Patch('units/:id')
  @RequirePermissions('units.manage')
  updateUnit(
    @Param('id') id: string,
    @Body() dto: UpdateUnitDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.updateUnit(id, dto, user.id);
  }

  @Delete('units/:id')
  @RequirePermissions('units.manage')
  removeUnit(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.removeUnit(id, user.id);
  }

  // ─── Unit Conversions ────────────────────────────────────────────────────

  @Get('unit-conversions')
  @RequirePermissions('units.view')
  findAllConversions(@Query() query: QueryUnitDto, @CurrentUser() user: AuthUser) {
    return this.service.findAllConversions(query, user);
  }

  @Post('unit-conversions')
  @RequirePermissions('units.manage')
  createConversion(
    @Body() dto: CreateUnitConversionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.createConversion(dto, user.id);
  }

  @Patch('unit-conversions/:id')
  @RequirePermissions('units.manage')
  updateConversion(
    @Param('id') id: string,
    @Body() dto: UpdateUnitConversionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.updateConversion(id, dto, user.id);
  }

  @Delete('unit-conversions/:id')
  @RequirePermissions('units.manage')
  removeConversion(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.removeConversion(id, user.id);
  }
}
