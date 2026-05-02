import { Controller, Get, Post, Put, Body, Param, Query } from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { DocumentNumberSequencesService } from './document-number-sequences.service';

@Controller('document-number-sequences')
export class DocumentNumberSequencesController {
  constructor(private readonly service: DocumentNumberSequencesService) {}

  @Get()
  @RequirePermissions('doc_sequences.list')
  findAll(@Query() query: any) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('doc_sequences.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('doc_sequences.create')
  create(@Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('doc_sequences.update')
  update(@Param('id') id: string, @Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  @Post(':id/next')
  @RequirePermissions('doc_sequences.update')
  nextNumber(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.nextNumber(id, user);
  }
}
