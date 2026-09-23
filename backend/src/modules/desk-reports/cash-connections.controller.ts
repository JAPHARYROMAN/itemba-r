import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { IsOptional, IsUUID, IsString, Length, Matches } from 'class-validator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { DeskReportQuery } from './desk-reports.dto';
import { CashConnectionsService } from './cash-connections.service';
export class ConnectionDto {
  @IsOptional() @IsUUID() deskAccountId?: string;
  @IsString() @Length(1, 128) cashAccountId!: string;
  @IsString() @Length(1, 128) ledgerAccountId!: string;
}
export class CashPostDto {
  @Matches(/^[a-f0-9]{64}$/) fingerprint!: string;
  @IsOptional() @IsString() @Length(1, 128) offsetAccountId?: string;
}
@Controller('cash-connections')
@RequirePermissions('cash_desk.view', 'journal_entries.view')
export class CashConnectionsController {
  constructor(private readonly service: CashConnectionsService) {}
  @Get('unlinked-payments')
  @RequirePermissions('cash_desk.view', 'invoice_desk.view', 'journal_entries.view')
  unlinked(@CurrentUser() user: AuthUser, @Query() q: DeskReportQuery) {
    return this.service.unlinkedPayments(user, q);
  }
  @Get('accounts')
  accounts(@CurrentUser() user: AuthUser, @Query() q: DeskReportQuery) {
    return this.service.connections(user, q);
  }
  @Post('accounts')
  @RequirePermissions(
    'cash_desk.view',
    'cash_desk.manage',
    'cash_accounts.manage',
    'journal_entries.view',
  )
  connect(@CurrentUser() user: AuthUser, @Body() dto: ConnectionDto) {
    return this.service.connect(user, dto);
  }
  @Get('movements')
  list(@CurrentUser() user: AuthUser, @Query() q: DeskReportQuery) {
    return this.service.list(user, q);
  }
  @Get('movements/:id')
  review(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.review(user, id);
  }
  @Post('movements/:id')
  @RequirePermissions(
    'cash_desk.view',
    'journal_entries.view',
    'journal_entries.create',
    'journal_entries.post',
  )
  post(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CashPostDto,
  ) {
    return this.service.post(user, id, dto);
  }
}
