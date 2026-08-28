import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CrudCoverageService } from './crud-coverage.service';

/** Operator-only proof surface; excluded from Msaidizi's own tool manifest. */
@ApiTags('msaidizi')
@ApiBearerAuth()
@AgentExcluded()
@RequirePermissions('msaidizi.use', 'audit-logs.read')
@Controller('msaidizi/crud-coverage')
export class CrudCoverageController {
  constructor(private readonly coverage: CrudCoverageService) {}

  @Get()
  @ApiOperation({ summary: 'Generate the machine-readable Msaidizi ERP CRUD coverage report' })
  report() {
    return this.coverage.report();
  }
}
