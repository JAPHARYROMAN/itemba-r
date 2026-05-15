import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuditSeverity } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { AuditLogsService } from './audit-logs.service';

@ApiTags('audit-logs')
@ApiBearerAuth()
@RequirePermissions('audit-logs.read')
@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly service: AuditLogsService) {}

  /** Full filtered, paginated list of audit logs. */
  @Get()
  findAll(
    @Query('search') search?: string,
    @Query('userId') userId?: string,
    @Query('companyId') companyId?: string,
    @Query('action') action?: string,
    @Query('entityType') entityType?: string,
    @Query('severity') severity?: AuditSeverity,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.service.findAll(
      {
        search,
        userId,
        companyId,
        action,
        entityType,
        severity,
        dateFrom,
        dateTo,
        page: page ? parseInt(page, 10) : 1,
        limit: limit ? parseInt(limit, 10) : 50,
      },
      user,
    );
  }

  /** Summary stats for dashboard. */
  @Get('summary')
  getSummary(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.service.getSummary(dateFrom, dateTo, user);
  }

  /** Recent CRITICAL + HIGH severity events. */
  @Get('sensitive')
  findSensitive(@Query('limit') limit?: string, @CurrentUser() user?: AuthUser) {
    return this.service.findSensitive(limit ? parseInt(limit, 10) : 100, user);
  }

  /** Distinct entity types — useful for filter dropdowns. */
  @Get('entity-types')
  getEntityTypes(@CurrentUser() user?: AuthUser) {
    return this.service.getEntityTypes(user);
  }

  /** All audit events for a specific entity (e.g. a Loan, Contract, etc.) */
  @Get('entity/:entityType/:entityId')
  findByEntity(
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.service.findByEntity(entityType, entityId, user);
  }

  /** All audit events attributed to a specific user. */
  @Get('user/:userId')
  findByUser(
    @Param('userId') userId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.service.findByUser(
      userId,
      {
        page: page ? parseInt(page, 10) : 1,
        limit: limit ? parseInt(limit, 10) : 50,
      },
      user,
    );
  }

  /** Get a single audit log entry by ID. */
  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user?: AuthUser) {
    return this.service.findOne(id, user);
  }
}
