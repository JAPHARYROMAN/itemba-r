import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../../common/decorators/current-user.decorator';
import { ComplianceDocumentStatusService } from './compliance-document-status.service';
import { CreateComplianceDocumentStatusDto } from './dto/create-compliance-document-status.dto';
import { UpdateComplianceDocumentStatusDto } from './dto/update-compliance-document-status.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('compliance/document-status')
export class ComplianceDocumentStatusController {
  constructor(private readonly service: ComplianceDocumentStatusService) {}

  @Get()
  @RequirePermissions('compliance_document_status.view')
  findAll(@CurrentUser() user: AuthUser, @Query() query: any) {
    return this.service.findAll(user, query);
  }

  @Get(':id')
  @RequirePermissions('compliance_document_status.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('compliance_document_status.manage')
  create(@Body() dto: CreateComplianceDocumentStatusDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('compliance_document_status.manage')
  update(@Param('id') id: string, @Body() dto: UpdateComplianceDocumentStatusDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('compliance_document_status.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
