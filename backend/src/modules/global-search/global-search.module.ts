import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CompanyScopeService, OrganizationScopeService } from '../../common/services';
import { GlobalSearchController } from './global-search.controller';
import { GlobalSearchService } from './global-search.service';

@Module({
  imports: [PrismaModule],
  controllers: [GlobalSearchController],
  providers: [GlobalSearchService, CompanyScopeService, OrganizationScopeService],
})
export class GlobalSearchModule {}
