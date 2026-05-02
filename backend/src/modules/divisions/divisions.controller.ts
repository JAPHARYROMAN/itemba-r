import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { DivisionsService } from './divisions.service';
import { CreateDivisionDto } from './dto/create-division.dto';
import { UpdateDivisionDto } from './dto/update-division.dto';

@ApiTags('divisions')
@ApiBearerAuth()
@Controller('divisions')
export class DivisionsController {
  constructor(private readonly service: DivisionsService) {}

  @Get()
  @RequirePermissions('divisions.read')
  findAll(@CurrentUser() user: AuthUser, @Query('companyId') companyId?: string) {
    return this.service.findAll(user, companyId);
  }

  @Get(':id')
  @RequirePermissions('divisions.read')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('divisions.create')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateDivisionDto) {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('divisions.update')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateDivisionDto) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('divisions.delete')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(id, user);
  }
}
