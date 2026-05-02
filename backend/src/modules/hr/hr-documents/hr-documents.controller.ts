import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../../common/decorators/current-user.decorator';
import { HrDocumentsService } from './hr-documents.service';
import { CreateHrDocumentDto } from './dto/create-hr-document.dto';
import { UpdateHrDocumentDto } from './dto/update-hr-document.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('hr/documents')
export class HrDocumentsController {
  constructor(private readonly service: HrDocumentsService) {}

  @Get()
  @RequirePermissions('hr_documents.view')
  findAll(@CurrentUser() user: AuthUser, @Query() query: any) {
    return this.service.findAll(user, query);
  }

  @Get(':id')
  @RequirePermissions('hr_documents.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('hr_documents.manage')
  create(@Body() dto: CreateHrDocumentDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('hr_documents.manage')
  update(@Param('id') id: string, @Body() dto: UpdateHrDocumentDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('hr_documents.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
