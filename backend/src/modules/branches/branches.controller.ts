import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { BranchesService } from './branches.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';

@ApiTags('branches')
@ApiBearerAuth()
@Controller('branches')
export class BranchesController {
  constructor(private readonly service: BranchesService) {}

  @Get()
  @RequirePermissions('branches.read')
  findAll(
    @CurrentUser() user: AuthUser,
    @Query('divisionId') divisionId?: string,
    @Query('companyId') companyId?: string,
    @Query('activeOnly') activeOnly?: string,
  ) {
    return this.service.findAll(user, {
      divisionId,
      companyId,
      activeOnly: activeOnly === 'true' || activeOnly === '1',
    });
  }

  @Get(':id')
  @RequirePermissions('branches.read')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('branches.create')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateBranchDto) {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('branches.update')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateBranchDto) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('branches.delete')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(id, user);
  }
}
