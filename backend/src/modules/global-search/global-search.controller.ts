import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { GlobalSearchService } from './global-search.service';

@Controller('global-search')
export class GlobalSearchController {
  constructor(private readonly service: GlobalSearchService) {}

  @Get()
  search(
    @CurrentUser() user: AuthUser,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query('companyId') companyId?: string,
  ) {
    return this.service.search({ q, limit, companyId }, user);
  }
}
