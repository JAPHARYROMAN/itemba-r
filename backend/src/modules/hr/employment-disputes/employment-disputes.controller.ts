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
import { EmploymentDisputesService } from './employment-disputes.service';
import {
  CreateDirectGrievanceDto,
  CreateEmploymentDisputeDto,
} from './dto/create-employment-dispute.dto';
import {
  MediateDisputeDto,
  ReferCmaDisputeDto,
  ResolveDisputeDto,
  UpdateEmploymentDisputeDto,
} from './dto/update-employment-dispute.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('hr/employment-disputes')
export class EmploymentDisputesController {
  constructor(private readonly service: EmploymentDisputesService) {}

  @Get()
  @RequirePermissions('employees.view')
  findAll(@Query() q: Record<string, string>, @CurrentUser() user: AuthUser) {
    return this.service.findAll(
      {
        page: q.page ? Number(q.page) : undefined,
        limit: q.limit ? Number(q.limit) : undefined,
        companyId: q.companyId,
        divisionId: q.divisionId,
        branchId: q.branchId,
        employeeId: q.employeeId,
        status: q.status,
        directToGroupHr:
          q.directToGroupHr === undefined ? undefined : q.directToGroupHr === 'true',
      },
      user,
    );
  }

  @Get(':id')
  @RequirePermissions('employees.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('employees.update')
  create(@Body() dto: CreateEmploymentDisputeDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Post('direct-grievance')
  @RequirePermissions('employees.view')
  createDirectGrievance(@Body() dto: CreateDirectGrievanceDto, @CurrentUser() user: AuthUser) {
    return this.service.createDirectGrievance(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('employees.update')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateEmploymentDisputeDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Patch(':id/mediate')
  @RequirePermissions('employees.update')
  mediate(@Param('id') id: string, @Body() dto: MediateDisputeDto, @CurrentUser() user: AuthUser) {
    return this.service.startMediation(id, dto, user);
  }

  @Patch(':id/refer-cma')
  @RequirePermissions('employees.update')
  referCma(
    @Param('id') id: string,
    @Body() dto: ReferCmaDisputeDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.referToCma(id, dto, user);
  }

  @Patch(':id/resolve')
  @RequirePermissions('employees.update')
  resolve(@Param('id') id: string, @Body() dto: ResolveDisputeDto, @CurrentUser() user: AuthUser) {
    return this.service.resolve(id, dto, user);
  }

  @Patch(':id/withdraw')
  @RequirePermissions('employees.update')
  withdraw(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.withdraw(id, user);
  }

  @Delete(':id')
  @RequirePermissions('employees.delete')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
