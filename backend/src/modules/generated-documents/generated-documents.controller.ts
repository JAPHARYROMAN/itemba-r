import { Controller, Get, Param, Query } from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { GeneratedDocumentsService } from './generated-documents.service';

@Controller('generated-documents')
export class GeneratedDocumentsController {
  constructor(private readonly service: GeneratedDocumentsService) {}

  @Get()
  @RequirePermissions('generated_documents.list')
  findAll(@Query() query: any) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('generated_documents.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }
}
