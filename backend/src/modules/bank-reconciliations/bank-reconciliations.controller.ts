import { Controller, Get, Post, Put, Body, Param, Query } from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { BankReconciliationsService } from './bank-reconciliations.service';
import {
  AddBankStatementLineDto,
  CreateBankReconciliationDto,
  QueryBankReconciliationDto,
  UpsertBankReconciliationDto,
} from './dto/bank-reconciliation.dto';
import { IsIn, IsNumber, IsOptional, IsString } from 'class-validator';

class RunBankMatchingDto {
  @IsOptional()
  @IsNumber()
  dateWindowDays?: number;

  @IsOptional()
  @IsNumber()
  amountToleranceCents?: number;
}

class ManualBankMatchDto {
  @IsString()
  statementLineId!: string;

  @IsString()
  journalEntryLineId!: string;
}

class UnmatchBankStatementLineDto {
  @IsString()
  statementLineId!: string;
}

class PostBankAdjustmentDto {
  @IsOptional()
  @IsString()
  statementLineId?: string;

  @IsNumber()
  amount!: number;

  @IsIn(['INCREASE_CASH', 'DECREASE_CASH'])
  direction!: 'INCREASE_CASH' | 'DECREASE_CASH';

  @IsOptional()
  @IsString()
  offsetAccountId?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  transactionDate?: string;
}

@Controller('bank-reconciliations')
export class BankReconciliationsController {
  constructor(private readonly service: BankReconciliationsService) {}

  @Get()
  @RequirePermissions('bank_reconciliations.list')
  findAll(@Query() query: QueryBankReconciliationDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('bank_reconciliations.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('bank_reconciliations.create')
  create(@Body() dto: CreateBankReconciliationDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('bank_reconciliations.update')
  update(
    @Param('id') id: string,
    @Body() dto: UpsertBankReconciliationDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Get(':id/lines')
  @RequirePermissions('bank_reconciliations.view')
  getLines(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.getLines(id, user);
  }

  @Post(':id/lines')
  @RequirePermissions('bank_reconciliations.update')
  addLine(
    @Param('id') id: string,
    @Body() dto: AddBankStatementLineDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.addLine(id, dto, user);
  }

  @Post(':id/run-matching')
  @RequirePermissions('bank_reconciliations.update')
  runMatching(
    @Param('id') id: string,
    @Body() body: RunBankMatchingDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.runMatching(id, user, body ?? {});
  }

  @Post(':id/match')
  @RequirePermissions('bank_reconciliations.update')
  manualMatch(
    @Param('id') id: string,
    @Body() body: ManualBankMatchDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.manualMatch(id, body.statementLineId, body.journalEntryLineId, user);
  }

  @Post(':id/unmatch')
  @RequirePermissions('bank_reconciliations.update')
  unmatch(
    @Param('id') id: string,
    @Body() body: UnmatchBankStatementLineDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.unmatch(id, body.statementLineId, user);
  }

  @Post(':id/adjustments')
  @RequirePermissions('bank_reconciliations.update')
  postAdjustment(
    @Param('id') id: string,
    @Body() body: PostBankAdjustmentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.postAdjustment(id, body, user);
  }

  @Post(':id/approve')
  @RequirePermissions('bank_reconciliations.approve')
  approve(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.approve(id, user);
  }

  @Post(':id/close')
  @RequirePermissions('bank_reconciliations.close')
  close(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.close(id, user);
  }
}
