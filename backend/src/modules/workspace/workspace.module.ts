import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { EncryptionService } from '../../common/services/encryption.service';
import { CompanyScopeService } from '../../common/services/company-scope.service';
import { OrganizationScopeService } from '../../common/services/organization-scope.service';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceService } from './workspace.service';
import { WorkspaceDraftsService } from './workspace-drafts.service';
import { WorkspaceDraftPolicy } from './workspace-draft-policy';
@Module({ imports: [PrismaModule], controllers: [WorkspaceController], providers: [WorkspaceService, WorkspaceDraftsService, WorkspaceDraftPolicy, EncryptionService, CompanyScopeService, OrganizationScopeService] })
export class WorkspaceModule {}
