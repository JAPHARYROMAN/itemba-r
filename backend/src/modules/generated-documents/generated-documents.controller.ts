import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { GeneratedDocumentsService } from './generated-documents.service';
import { GenerateBusinessPdfDto } from './dto/generate-business-pdf.dto';

@Controller('generated-documents')
export class GeneratedDocumentsController {
  constructor(private readonly service: GeneratedDocumentsService) {}

  @Get()
  @RequirePermissions('generated_documents.list')
  findAll(@Query() query: any, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Post('pdf')
  @RequirePermissions('documents.manage')
  generatePdf(
    @Body() dto: GenerateBusinessPdfDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.service.generateBusinessPdf(dto, user, req.ip);
  }

  @Get(':id')
  @RequirePermissions('generated_documents.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }
}
