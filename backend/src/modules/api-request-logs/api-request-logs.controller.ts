import { Controller, Get, Query } from '@nestjs/common';
import { ApiRequestLogsService } from './api-request-logs.service';
import { QueryApiRequestLogDto } from './dto/query-api-request-log.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('api-request-logs')
export class ApiRequestLogsController {
  constructor(private readonly service: ApiRequestLogsService) {}

  @Get()
  @RequirePermissions('api_request_logs.view')
  findAll(@Query() query: QueryApiRequestLogDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }
}
