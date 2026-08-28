import { DisciplinaryActionsQueryDto } from '../../../common/dto/resource-query.dto';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../../common/decorators/current-user.decorator';
import { DisciplinaryActionsService } from './disciplinary-actions.service';
import { CreateDisciplinaryActionDto } from './dto/create-disciplinary-action.dto';
import { UpdateDisciplinaryActionDto } from './dto/update-disciplinary-action.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('hr/disciplinary-actions')
export class DisciplinaryActionsController {
  constructor(private readonly service: DisciplinaryActionsService) {}

  @Get()
  @RequirePermissions('disciplinary_actions.view')
  findAll(@CurrentUser() user: AuthUser, @Query() q: DisciplinaryActionsQueryDto) {
    return this.service.findAll({
      user,
      page: q.page ? Number(q.page) : undefined,
      limit: q.limit ? Number(q.limit) : undefined,
      companyId: q.companyId,
      employeeId: q.employeeId,
      status: q.status,
      type: q.type,
    });
  }

  @Get(':id')
  @RequirePermissions('disciplinary_actions.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('disciplinary_actions.create')
  create(@Body() dto: CreateDisciplinaryActionDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('disciplinary_actions.update')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateDisciplinaryActionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Patch(':id/approve')
  @RequirePermissions('disciplinary_actions.approve.hr')
  approve(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.approve(id, user);
  }

  @Delete(':id')
  @RequirePermissions('disciplinary_actions.delete')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
