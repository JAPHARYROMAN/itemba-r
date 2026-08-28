import { MedicalExamRecordsQueryDto } from '../../../common/dto/resource-query.dto';
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
import { AgentExcluded } from '../../../common/decorators/agent-excluded.decorator';
import { CurrentUser, AuthUser } from '../../../common/decorators/current-user.decorator';
import { MedicalExamRecordsService } from './medical-exam-records.service';
import { CreateMedicalExamRecordDto } from './dto/create-medical-exam-record.dto';
import { UpdateMedicalExamRecordDto } from './dto/update-medical-exam-record.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('hr/medical-exam-records')
export class MedicalExamRecordsController {
  constructor(private readonly service: MedicalExamRecordsService) {}

  @Get()
  @RequirePermissions('employees.view')
  findAll(@Query() query: MedicalExamRecordsQueryDto) {
    return this.service.findAll({
      page: query.page ? Number(query.page) : undefined,
      limit: query.limit ? Number(query.limit) : undefined,
      companyId: query.companyId,
      employeeId: query.employeeId,
      fitnessStatus: query.fitnessStatus,
      expiringDays: query.expiringDays ? Number(query.expiringDays) : undefined,
      hazardOnly: query.hazardOnly === 'true',
    });
  }

  @Get(':id')
  @AgentExcluded('company_scope_not_enforced')
  @RequirePermissions('employees.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('employees.update')
  create(@Body() dto: CreateMedicalExamRecordDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Patch(':id')
  @RequirePermissions('employees.update')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateMedicalExamRecordDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermissions('employees.update')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id);
  }
}
