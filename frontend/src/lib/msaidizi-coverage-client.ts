/**
 * The CRUD coverage report, as the browser reaches it.
 *
 * One read-only endpoint, behind the same proxy as everything else. It requires
 * both `msaidizi.use` and `audit-logs.read`: the report names every endpoint the
 * agent can reach, which is itself worth restricting.
 */

import { backendGet } from './api-client';
import type { CrudCoverageReport } from './msaidizi-coverage-types';

export function fetchMsaidiziCrudCoverage(): Promise<CrudCoverageReport> {
  return backendGet<CrudCoverageReport>('/msaidizi/crud-coverage');
}
