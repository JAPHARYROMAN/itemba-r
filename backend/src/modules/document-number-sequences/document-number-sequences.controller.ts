import { Controller, Get, Post, Put, Body, Param, Query } from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { DocumentNumberSequencesService } from './document-number-sequences.service';
import {
  CreateDocumentNumberSequenceDto,
  QueryDocumentNumberSequenceDto,
  UpdateDocumentNumberSequenceDto,
} from './dto/document-number-sequence.dto';

@Controller('document-number-sequences')
export class DocumentNumberSequencesController {
  constructor(private readonly service: DocumentNumberSequencesService) {}

  @Get()
  @RequirePermissions('doc_sequences.list')
  findAll(@Query() query: QueryDocumentNumberSequenceDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('doc_sequences.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('doc_sequences.create')
  create(@Body() dto: CreateDocumentNumberSequenceDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('doc_sequences.update')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateDocumentNumberSequenceDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Post(':id/next')
  @RequirePermissions('doc_sequences.update')
  nextNumber(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.nextNumber(id, user);
  }
}
