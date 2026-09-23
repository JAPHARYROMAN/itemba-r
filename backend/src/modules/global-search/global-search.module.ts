import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CompanyScopeService, OrganizationScopeService } from '../../common/services';
import { GlobalSearchController } from './global-search.controller';
import { GlobalSearchService } from './global-search.service';
import { DeskSearchService } from './desk-search.service';

@Module({
  imports: [PrismaModule],
  controllers: [GlobalSearchController],
  providers: [
    GlobalSearchService,
    DeskSearchService,
    CompanyScopeService,
    OrganizationScopeService,
  ],
})
export class GlobalSearchModule {}
