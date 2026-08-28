import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import { Request } from 'express';
import { ContractsService } from './contracts.service';
import { CreateContractDto } from './dto/create-contract.dto';
import { UpdateContractDto } from './dto/update-contract.dto';
import { QueryContractDto } from './dto/query-contract.dto';
import { ChangeContractStatusDto } from './dto/change-contract-status.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';
import { SensitiveAccessInterceptor } from '../../common/interceptors/sensitive-access.interceptor';
import { SensitiveAccess } from '../../common/decorators/sensitive-access.decorator';

@Controller('contracts')
@SensitiveAccess('Contracts')
@UseInterceptors(SensitiveAccessInterceptor)
export class ContractsController {
  constructor(private readonly service: ContractsService) {}

  @Get()
  @RequirePermissions('contracts.view')
  findAll(@Query() query: QueryContractDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get('summary')
  @RequirePermissions('contracts.view')
  getSummary(@CurrentUser() user: AuthUser, @Query('companyId') companyId?: string) {
    return this.service.getSummary(user, companyId);
  }

  @Get('expiring')
  @RequirePermissions('contracts.view')
  getExpiring(@CurrentUser() user: AuthUser, @Query('days') days?: string) {
    return this.service.getExpiring(user, days ? parseInt(days, 10) : 60);
  }

  @Get(':id')
  @AgentExcluded('read_writes_audit_ledger')
  @RequirePermissions('contracts.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.service.findOne(id, user, req.ip);
  }

  @Get(':id/audit-history')
  @AgentExcluded('read_writes_audit_ledger')
  @RequirePermissions('contracts.view')
  getAuditHistory(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.getAuditHistory(id, user);
  }

  @Post()
  @RequirePermissions('contracts.manage')
  create(@Body() dto: CreateContractDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.service.create(dto, user, req.ip);
  }

  @Put(':id')
  @RequirePermissions('contracts.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateContractDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.service.update(id, dto, user, req.ip);
  }

  @Patch(':id/status')
  @RequirePermissions('contracts.manage')
  changeStatus(
    @Param('id') id: string,
    @Body() dto: ChangeContractStatusDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.service.changeStatus(id, dto, user, req.ip);
  }

  @Delete(':id')
  @RequirePermissions('contracts.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.service.remove(id, user, req.ip);
  }
}
