import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CompanyScopeService } from '../../common/services/company-scope.service';
import { OrganizationScopeService } from '../../common/services/organization-scope.service';
import { PartyProfileController } from './party-profile.controller';
import { PartyProfileService } from './party-profile.service';

/** Depends only on Prisma and the scope services, so it never cycles back into a desk. */
@Module({
  imports: [PrismaModule],
  controllers: [PartyProfileController],
  providers: [PartyProfileService, CompanyScopeService, OrganizationScopeService],
  exports: [PartyProfileService],
})
export class PartyProfileModule {}
