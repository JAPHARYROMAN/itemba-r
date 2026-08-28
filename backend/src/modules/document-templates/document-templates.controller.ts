import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { DocumentTemplatesQueryDto } from '../../common/dto/resource-query.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { DocumentTemplatesService } from './document-templates.service';
import { CreateDocumentTemplateDto, UpdateDocumentTemplateDto } from './dto/document-template.dto';

@Controller('document-templates')
export class DocumentTemplatesController {
  constructor(private readonly service: DocumentTemplatesService) {}

  @Get()
  @RequirePermissions('document_templates.list')
  findAll(@Query() query: DocumentTemplatesQueryDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('document_templates.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('document_templates.create')
  create(@Body() dto: CreateDocumentTemplateDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('document_templates.update')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateDocumentTemplateDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('document_templates.delete')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }

  @Post(':id/activate')
  @RequirePermissions('document_templates.update')
  activate(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.setActive(id, true, user);
  }

  @Post(':id/deactivate')
  @RequirePermissions('document_templates.update')
  deactivate(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.setActive(id, false, user);
  }
}
