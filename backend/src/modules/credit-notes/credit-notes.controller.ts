import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CreditNotesService } from './credit-notes.service';
import { CreateCreditNoteDto } from './dto/create-credit-note.dto';
import { QueryCreditNoteDto } from './dto/query-credit-note.dto';
import { VoidCreditNoteDto } from './dto/void-credit-note.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

/**
 * Credit notes reuse the AR (receivables) permission surface: viewing needs
 * `receivables.view`, mutating/posting needs `receivables.manage`. A dedicated
 * `credit_notes` permission can be seeded later without changing this contract.
 */
@Controller('credit-notes')
export class CreditNotesController {
  constructor(private readonly service: CreditNotesService) {}

  @Get()
  @RequirePermissions('receivables.view')
  findAll(@Query() query: QueryCreditNoteDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('receivables.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('receivables.manage')
  create(@Body() dto: CreateCreditNoteDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id/issue')
  @RequirePermissions('receivables.manage')
  issue(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.issue(id, user);
  }

  @Patch(':id/void')
  @RequirePermissions('receivables.manage')
  void(@Param('id') id: string, @Body() dto: VoidCreditNoteDto, @CurrentUser() user: AuthUser) {
    return this.service.void(id, dto, user);
  }
}
